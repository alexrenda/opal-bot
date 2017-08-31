/**
 * A calendar source that is stored on a remote Opal node.
 */

import * as argparse from 'argparse';
import * as calbase from './calbase';
import * as caldav from './caldav';
import * as http from 'http';
import * as libweb from '../libweb';
import * as moment from 'moment';
import * as office from './office';
import * as opal from 'opal';
import * as url from 'url';
import * as util from '../lib/util';

/**
 * A client that functions as a transparent proxy for a remote calendar
 */
export class Calendar implements calbase.Calendar {
  private remote: RemoteCalendarNode;
  constructor(hostname: string, port: number) {
    this.remote = new RemoteCalendarNode(hostname, port);
  }

  public async getEvents(start: moment.Moment, end: moment.Moment) {
    // opal-tranformer expects a variable named "ctx" in scope
    let ctx = opal.ctx;
    // opal-transformer expects a variable named "remote" in scope
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

  async scheduleEvent(event: calbase.Event): Promise<boolean> {
    // opal-tranformer expects a variable named "ctx" in scope
    let ctx = opal.ctx;
    // opal-transformer expects a variable named "remote" in scope
    let remote = this.remote;
    out result;
    let world = hyp of {
      with remote {
        result = await remote.scheduleEvent(event);
      }
    }
    return await ctx.commit(world)
      .then(() => ctx.get<boolean>(result, world), () => false);
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

  public async scheduleEvent(event: calbase.Event) : Promise<boolean> {
    // re-initialize moments since Opal de-classifies them (and passes only data)
    event.start = moment(event.start);
    event.end = moment(event.end);

    if (this.underlying === null) {
      throw Error('Underlying not set!');
    }

    return await this.underlying.scheduleEvent(event);
  }

  public getId() {
    return `${this.hostname}:{this.port}`;
  }
}

async function main() {
  let parser = new argparse.ArgumentParser({ description: 'Launch a remote calendar' });
  parser.addArgument(['hostname'], { help: 'Hostname to run on' });
  parser.addArgument(['port'], { type: 'int', help: 'Port to run on' });

  let subParsers = parser.addSubparsers({ dest: 'caltyp' });
  let caldavParser = subParsers.addParser('caldav', { help: 'Read a caldav calendar' });
  caldavParser.addArgument(['url'], { help: 'URL to query for the calendar' });
  caldavParser.addArgument(['username'], { help: 'User to query for' });
  caldavParser.addArgument(['password'], { help: 'Password to use' });

  let officeParser = subParsers.addParser('office', { help: 'Read an office calendar' });
  officeParser.addArgument(['--client_id'], {
    help: 'Office ID to use. If empty, must have environmental variable OFFICE_CLIENT_ID set.',
    required: false
  });
  officeParser.addArgument(['--client_secret'], {
    help: 'Office secret to use. If empty, must have environmental variable OFFICE_CLIENT_SECRET set.',
    required: false
  });

  let remoteParser = subParsers.addParser('remote', { help: 'Proxy through a remote calendar' });
  remoteParser.addArgument(['proxyHostname'], { help: 'Hostname of proxy' });
  remoteParser.addArgument(['proxyPort'], { help: 'Port of proxy' });

  let args = parser.parseArgs();

  let cal: calbase.Calendar;

  if (args.caltyp === 'caldav') {
    cal = new caldav.Calendar(args.url, args.username, args.password);
  } else if (args.caltyp === 'office') {

    // read client_id and client_secret from args then env
    let client_id: string;
    if (args.client_id !== null) {
      client_id = args.client_id;
    } else if (process.env['OFFICE_CLIENT_ID'] !== undefined) {
      client_id = process.env['OFFICE_CLIENT_ID'];
    } else {
      throw new Error('OFFICE_CLIENT_ID must be set, either through an argument or an environmental variable');
    }

    let client_secret: string;
    if (args.client_secret !== null) {
      client_secret = args.client_secret;
    } else if (process.env['OFFICE_CLIENT_SECRET'] !== undefined) {
      client_secret = process.env['OFFICE_CLIENT_SECRET'];
    } else {
      throw new Error('OFFICE_CLIENT_SECRET must be set, either through an argument or an environmental variable');
    }

    // the hostname/port are either localhost/57768 or can be made
    // more specific with WEB_URL
    let port : number = 57768;
    let hostname : string;

    // read the hostname/port if it's given in WEB_RUL
    if (process.env['WEB_URL']) {
      let parsed = url.parse(process.env['WEB_URL']);
      if (!parsed.hostname) {
        throw new Error('WEB_URL must have a valid hostname');
      }
      hostname = parsed.hostname;

      if (parsed.port !== undefined) {
        port = parseInt(parsed.port);
      }
    } else {
      hostname = 'localhost';
    }

    // set up the oauth callback server
    let routes : libweb.Route[] = [];
    let server = http.createServer(libweb.dispatch(routes));

    // start the server, and get the port it was started on (if it was dynamic)
    port = await new Promise<number>((resolve, reject) => {
      server.listen(port, () => {
        resolve(server.address().port);
      });
    });

    let callback_url = util.formatServedUrl(`http://${hostname}:${port}`);

    // create the office client for getting a token
    let officeClient = new office.Client(client_id, client_secret, callback_url);
    routes.push(officeClient.authRoute);
    let auth = await officeClient.authenticate();

    console.log(`Visit ${auth.url} to authenticate`);

    let token = await auth.token;
    cal = new office.Calendar(token);
  } else if (args.caltyp === 'remote') {
    cal = new Calendar(args.proxyHostname, args.proxyPort);
  } else {
    throw Error(`Unrecognized calendar type "${args.caltyp}"`);
  }

  let remote = new RemoteCalendarNode(args.hostname, args.port);
  remote.setUnderlying(cal);

  opal.opal(async (ctx: opal.Context) => { }, remote);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
  });
}
