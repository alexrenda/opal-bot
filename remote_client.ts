/**
 * A server that proxies a remote calendar
 */

import * as argparse from 'argparse';
import * as http from 'http';
import * as https from 'https';
import * as libweb from './libweb';
import * as calbase from './multical/calbase';
import * as caldav from './multical/caldav';
import * as office from './multical/office';
import * as remote from './multical/remote';
import * as opal from 'opal';
import * as url from 'url';
import * as util from 'lib/util';

async function main() {
  let parser = new argparse.ArgumentParser({ description: 'Launch a remote calendar' });
  parser.addArgument(['hostname'], { help: 'Hostname to run on' });
  parser.addArgument(['port'], { type: 'int', help: 'Port to run on' });

  let subParsers = parser.addSubparsers({ dest: 'caltyp' });
  createCaldavParser(subParsers);
  createRemoteParser(subParsers);
  createOfficeParser(subParsers);
  let args = parser.parseArgs();

  let cal: calbase.Calendar;

  if (args.caltyp === 'caldav') {
    cal = await createCaldav(args);
  } else if (args.caltyp === 'office') {
    cal = await createOffice(args);
  } else if (args.caltyp === 'remote') {
    cal = await createRemote(args);
  } else {
    throw Error(`Unrecognized calendar type "${args.caltyp}"`);
  }

  let remoteNode = new remote.RemoteCalendarNode(args.hostname, args.port);
  remoteNode.setUnderlying(cal);

  opal.opal(async (ctx: opal.Context) => { }, remoteNode);
}

/* Caldav calendar parsing and creation
 * ====================================
 */

interface CaldavArgs {
  url: string,
  username: string,
  password: string,
};

async function createCaldavParser(subParsers: argparse.SubParser) {
  let caldavParser = subParsers.addParser('caldav', { help: 'Read a caldav calendar' });
  caldavParser.addArgument(['url'], { help: 'URL to query for the calendar' });
  caldavParser.addArgument(['username'], { help: 'User to query for' });
  caldavParser.addArgument(['password'], { help: 'Password to use' });
  return caldavParser;
}

async function createCaldav(args: CaldavArgs) {
  return new caldav.Calendar(args.url, args.username, args.password);
}

/* Remote calendar parsing and creation
 * ====================================
 */
interface RemoteArgs {
  proxyHostname: string,
  proxyPort: string,
};

async function createRemoteParser(subParsers: argparse.SubParser) {
  let remoteParser = subParsers.addParser('remote', { help: 'Proxy through a remote calendar' });
  remoteParser.addArgument(['proxyHostname'], { help: 'Hostname of proxy' });
  remoteParser.addArgument(['proxyPort'], { help: 'Port of proxy' });;
  return remoteParser;
}

async function createRemote(args: RemoteArgs) {
  return new remote.Calendar(args.proxyHostname, parseInt(args.proxyPort));
}

/* Office calendar parsing and creation
 * ====================================
 */
interface OfficeArgs {
  client_id: string,
  client_secret: string,
};

async function createOfficeParser(subParsers: argparse.SubParser) {
  let officeParser = subParsers.addParser('office', { help: 'Read an office calendar' });
  officeParser.addArgument(['--client_id'], {
    help: 'Office ID to use. If empty, must have environmental variable OFFICE_CLIENT_ID set.',
    required: false
  });
  officeParser.addArgument(['--client_secret'], {
    help: 'Office secret to use. If empty, must have environmental variable OFFICE_CLIENT_SECRET set.',
    required: false
  });
  return officeParser;
}

async function createOffice(args: OfficeArgs) {
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
  let port : number = 443;
  let hostname : string;

  // read the hostname/port if it's given in WEB_RUL
  if (process.env['WEB_URL']) {
    let parsed = url.parse(process.env['WEB_URL']);
    if (!parsed.hostname) {
      throw new Error('WEB_URL must have a valid hostname');
    }
    hostname = parsed.hostname;

    if (parsed.port !== null && parsed.port !== undefined) {
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
  return new office.Calendar(token);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
  });
}
