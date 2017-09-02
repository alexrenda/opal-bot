/**
 * A calendar source for CalDAV servers, including iCloud.
 */

import fetch from 'node-fetch';
import * as xml2js from 'xml2js';
import * as ical from 'ical.js';
import * as icsutil from './icsutil';
import * as calbase from './calbase';
import * as moment from 'moment';
import * as util from '../lib/util';

/**
 * Encode a string using base64.
 */
function base64encode(s: string) {
  return new Buffer(s).toString('base64');
}

/**
 * Construct an `Authorization` header for HTTP Basic Auth.
 */
function basicauth(username: string, password: string): string {
  return 'Basic ' + base64encode(username + ":" + password);
}

/**
 * Parse an XML string into an `xml2js` document, asynchronously.
 */
function parseXML(s: string): Promise<any> {
  return new Promise((resolve, reject) => {
    xml2js.parseString(s, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

/**
 * Parse the first event from a calendar document.
 *
 * CalDAV gives us "singleton" calendars containing just one VEVENT, so
 * this parses the ICS source as a calendar and then get the first (only)
 * calendar in it.
 */
function parseEvent(ics: string) {
  let cal = icsutil.parse(ics);
  for (let event of icsutil.getEvents(cal)) {
    return event;
  }
  throw "no event in calendar";
}

/**
 * Convert from an iCal time structure into a Moment.
 */
function dateFromICS(time: ical.Time): moment.Moment {
  return moment(time.toString());
}

/**
 * Convert a parsed iCal event into our common event representation.
 */
function eventFromICS(event: ical.Event): calbase.Event {
  return {
    title: event.summary,
    start: dateFromICS(event.startDate),
    end: dateFromICS(event.endDate),
  };
}

/**
 * Format a time for inclusion in an CalDAV query.
 *
 * This seems to be the "basic" format from ISO 8601. The full standard does
 * not seem to be supported.
 */
function davtime(t: moment.Moment) {
  return t.format('YYYYMMDD[T]HHmmss[Z]');
}

/**
 * Construct a CalDAV range query, which is an XML document, for getting the
 * events between two times.
 */
function rangeQuery(start: moment.Moment, end: moment.Moment) {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${davtime(start)}" end="${davtime(end)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
};

/**
 * A client for a specific CalDAV calendar.
 */
export class Calendar extends calbase.Calendar {
  constructor(
    public url: string,
    public username: string,
    public password: string,
  ) {
    super();
  }

  /**
   * Fetch events from the calendar between a pair of times.
   */
  async getEventsImpl(start: moment.Moment, end: moment.Moment) {
    let res = await fetch(this.url, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'text/xml',
        'Authorization': basicauth(this.username, this.password),
        'User-Agent': 'opal/1.0.0',
      },
      body: rangeQuery(start, end),
    });
    if (!res.ok) {
      throw "error communicating with CalDAV server";
    }
    let data = await parseXML(await res.text());

    // The response XML document has this form:
    //   <multistatus>
    //     <response><propstat><prop><calendar-data>[ICS HERE]
    //     ...
    //   </multistatus>
    // Parse each ICS document in this structure.
    let events = [];
    for (let response of data['multistatus']['response']) {
      let ics = response['propstat'][0]['prop'][0]['calendar-data'][0]['_'];
      events.push(parseEvent(ics));
    }

    return events.map(eventFromICS);
  }

  async scheduleEventImpl(event: calbase.Event): Promise<boolean> {
    let uid = util.randomString();

    // set up the even ical as a new separate calendar with a single event
    let cal_comp = new ical.Component(['vcalendar', [], []]);
    let event_comp = new ical.Component('vevent');
    event_comp.updatePropertyWithValue('uid', uid);
    cal_comp.addSubcomponent(event_comp);
    cal_comp.updatePropertyWithValue('version', '2.0');

    // convert calbase.Event to ical.Event
    let ical_event = new ical.Event(event_comp);
    ical_event.summary = event.title;
    ical_event.startDate = ical.Time.fromJSDate(event.start.toDate());
    ical_event.endDate = ical.Time.fromJSDate(event.end.toDate());

    // we must PUT to .../calendars/CALNAME/UID.ics
    let ics_path = uid + '.ics';
    let m_url: string;
    if (this.url.endsWith('/')) {
      m_url = this.url + ics_path;
    } else {
      m_url = this.url + '/' + ics_path;
    }

    let res = await fetch(m_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar',
        'Authorization': basicauth(this.username, this.password),
        'User-Agent': 'opal/1.0.0',
      },
      body: cal_comp.toString(),
    });

    return res.ok;
  }
}
