/**
 * A calendar source for CalDAV servers, including iCloud.
 */

import fetch from 'node-fetch';
import * as xml2js from 'xml2js';
import * as ical from 'ical.js';
import * as icsutil from './icsutil';
import * as calbase from './calbase';
import * as moment from 'moment';

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
export class Calendar implements calbase.Calendar {
  constructor(
    public url: string,
    public username: string,
    public password: string,
  ) {}

  /**
   * Fetch events from the calendar between a pair of times.
   */
  async getEvents(start: moment.Moment, end: moment.Moment) {
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

  async scheduleEvent(event: calbase.Event): Promise<boolean> {
    throw new Error('Unimplemented');
  }
}
