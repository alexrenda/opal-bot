/**
 * A calendar source that is stored on a remote Opal node.
 */

import * as argparse from 'argparse';
import * as calbase from './calbase';
import * as caldav from './caldav';
import * as moment from 'moment';
import * as office from './office';
import * as opal from 'opal';

/**
 * A client that functions as a transparent proxy for a remote calendar
 */
export class Calendar implements calbase.Calendar {
  private remote: RemoteCalendarNode;
  constructor(hostname: string, port: number) {
    this.remote = new RemoteCalendarNode(hostname, port);
  }

  public async getEvents(start: moment.Moment, end: moment.Moment) {
    // opal-tranformer expects a variable named ctx to be in scope
    let ctx = opal.ctx;
    // opal-transformer will put a variable named "remote" into scope in the with
    let remote = this.remote;
    out result;
    let world = hyp of {
      with remote {
        result = await remote.getEvents(start, end);
      }
    }
    let events: calbase.Event[] = await ctx.get(result, world) as calbase.Event[];

    // opal-distributed doesn't pass classes through, so we re-initialize moments
    return events.map((ev => {
      return { title: ev.title, start: moment(ev.start), end: moment(ev.end) };
    }));
  }
}

/**
 * An Opal node that represents a calendar endpoint, with a real
 * calendar some number of layers underneath (via underlying).
 */
class RemoteCalendarNode extends opal.OpalNode {
  private underlying: calbase.Calendar | null = null;

  /**
   * Set the underlying calendar. This can't be in the constructor
   * since remote.Calendar must be able to construct this class
   * remotely.
   */
  setUnderlying(cal: calbase.Calendar) {
    if (this.underlying !== null) {
      throw new Error('Underlying can only be set once!');
    }
    this.underlying = cal;
  }

  /**
   * Endpoint to actually get the events on a remote calendar.
   */
  public async getEvents(start: moment.Moment, end: moment.Moment) {
    // re-initialize moments since Opal de-classifies them (and passes only data)
    start = moment(start);
    end = moment(end);
    if (this.underlying === null) {
      throw Error('Underlying not set!');
    }

    return await this.underlying.getEvents(start, end);
  }

  public getId() {
    return `${this.hostname}:{this.port}`;
  }
}

if (require.main === module) {
  let parser = new argparse.ArgumentParser({ description: 'Launch a remote calendar' });
  parser.addArgument(['hostname'], { help: 'Hostname to run on' });
  parser.addArgument(['port'], { type: 'int', help: 'Port to run on' });

  let subParsers = parser.addSubparsers({ dest: 'caltyp' });
  let caldavParser = subParsers.addParser('caldav', { help: 'Read a caldav calendar' });
  caldavParser.addArgument(['url'], { help: 'URL to query for the calendar' });
  caldavParser.addArgument(['username'], { help: 'User to query for' });
  caldavParser.addArgument(['password'], { help: 'Password to use' });

  let officeParser = subParsers.addParser('office', { help: 'Read an office calendar' });
  officeParser.addArgument(['token'], { help: 'Token' });

  let remoteParser = subParsers.addParser('remote', { help: 'Proxy through a remote calendar' });
  remoteParser.addArgument(['proxyHostname'], { help: 'Hostname of proxy' });
  remoteParser.addArgument(['proxyPort'], { help: 'Port of proxy' });

  let args = parser.parseArgs();

  let cal: calbase.Calendar;

  if (args.caltyp === 'caldav') {
    cal = new caldav.Calendar(args.url, args.username, args.password);
  } else if (args.caltyp === 'office') {
    cal = new office.Calendar(args.token);
  } else if (args.caltyp === 'remote') {
    cal = new Calendar(args.proxyHostname, args.proxyPort);
  } else {
    throw Error(`Unrecognized calendar type "${args.caltyp}"`);
  }

  let remote = new RemoteCalendarNode(args.hostname, args.port);
  remote.setUnderlying(cal);

  opal.opal(async (ctx: opal.Context) => { }, remote);
}
