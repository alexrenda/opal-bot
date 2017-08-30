/**
 * A calendar source for Office 365 accounts.
 */

import * as oauth2 from 'simple-oauth2';
import * as libweb from '../libweb';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import * as outlook from 'node-outlook';
import * as jwt from 'jsonwebtoken';
import * as calbase from './calbase';
import * as moment from 'moment';

/**
 * OAuth2 parameters for connecting to Office 365.
 */
const OAUTH_PARAMS = {
  tokenHost: "https://login.microsoftonline.com",
  tokenPath: "common/oauth2/v2.0/token",
  authorizePath: "common/oauth2/v2.0/authorize",
};

/**
 * The OAuth2 scopes we need to request.
 */
const SCOPES = [
  "openid",
  "profile",  // Required to get user's email address.
  "https://outlook.office.com/calendars.readwrite",
];

/**
 * The path for OAuth2 callbacks.
 */
const AUTH_ENDPOINT = '/office/auth';

/**
 * Generate a random string for use as a token.
 */
async function randomString(bytes = 32): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    crypto.randomBytes(bytes, (err, buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer.toString('base64'));
      }
    });
  });
}

/**
 * The token you need to authenticate requests to the Office API.
 */
export type Token = oauth2.AccessToken;

/**
 * The type for callbacks for successful authentication.
 */
export type TokenHandler = (token: Token) => void;

/**
 * An Office 365 authentication request.
 */
export interface Authentication {
  /**
   * The URL that the user should follow to log in to Office 365 in a
   * browser.
   */
  url: string;

  /**
   * A promise that resolves when the user has successfully completed the
   * login flow in the browser. Produces an authentication token that
   * can be used for future requests.
   */
  token: Promise<Token>;
};

/**
 * A client for dispatching authentication requests to the Office365 API.
 */
export class Client {
  readonly authRoute: libweb.Route;
  readonly auth: oauth2.OAuthClient;
  readonly callbackUrl: string;
  readonly handlers = new Map<string, TokenHandler>();

  constructor(id: string, secret: string, baseUrl: string) {
    this.auth = oauth2.create({
      client: { id, secret },
      auth: OAUTH_PARAMS,
    });

    this.callbackUrl = url.resolve(baseUrl, AUTH_ENDPOINT);

    this.authRoute = new libweb.Route(AUTH_ENDPOINT, async (req, res) => {
      let query = libweb.query(req);
      let code = query.get('code');
      if (!code) {
        console.error('missing code');
        res.end('missing code');
        return;
      }

      let t: oauth2.Token;
      try {
        t = await this.auth.authorizationCode.getToken({
          code,
          redirect_uri: this.callbackUrl,
        });
      } catch (err) {
        console.error('authorization error', err);
        res.end('token authorization error');
        return;
      }

      let token = this.auth.accessToken.create(t);
      this.authenticated(query.get('state'), token);
      res.end('ok');
    });
  }

  /**
   * Authenticate a user. This returns both the URL that the user should
   * follow to authenticate and a promise that resolves when the
   * authentication succeeds.
   */
  async authenticate(): Promise<Authentication> {
    let state = await randomString();

    let url = this.auth.authorizationCode.authorizeURL({
      redirect_uri: this.callbackUrl,
      scope: SCOPES.join(" "),
      state,
    });

    let promise = new Promise<Token>((resolve, reject) => {
      this.handlers.set(state, resolve);
    });

    return { url, token: promise };
  }

  /**
   * Our internal callback for when the authentication URL is triggered.
   */
  authenticated(state: string | null, token: Token) {
    if (!state) {
      return;
    }
    let cbk = this.handlers.get(state);
    if (cbk) {
      cbk(token);
    }
  }
}

/**
 * Given a `Moment`, format a string for the Office 365 REST API.
 */
function dateToOfficeLocal(m: moment.Moment): string {
  return m.format('YYYY-MM-DDThh:mm:ss');
}

/**
 * Get an authenticated user's email address.
 *
 * Since we request the appropriate scope, the token contains the user's email
 * (which serves as their user ID) embedded within it.
 */
function emailFromToken(token: Token): string {
  // Hack to extract the ID token from the OAuth token structure. This is a
  // base64-encoded JSON Web Token.
  let id_token: string = (token.token as any).id_token;
  let data = jwt.decode(id_token);
  if (!data) {
    throw "could not decode token";
  }
  return (data as any).preferred_username;
}

/**
 * Convert a date from the office API's representation into a Moment.
 */
function dateFromOffice(dt: outlook.DateTime): moment.Moment {
  // TODO: We're currently ignoring the embedded time zone.
  return moment(dt.DateTime);
}

/**
 * Convert an event from the office API into our public representation.
 */
function eventFromOffice(event: outlook.Event): calbase.Event {
  return {
    title: event.Subject,
    start: dateFromOffice(event.Start),
    end: dateFromOffice(event.End),
  };
}

/**
 * The parameters for `Calendar.request`.
 *
 * This is a subset of the parameters for the underlying library. We provide
 * the authentication token and the user details.
 */
type RequestParams = Pick<outlook.APICallParams, 'url' | 'method' | 'query' | 'payload'>;

/**
 * Views onto a particular Office 365 user's calendar data.
 */
export class Calendar implements calbase.Calendar {
  public readonly email: string;

  constructor(
    public readonly token: Token
  ) {
    this.email = emailFromToken(token);
  }

  /**
   * Internal wrapper for Office API requests.
   */
  request(params: RequestParams): Promise<any> {
    // The Office API only wants the access token string. And the OAuth
    // library's typings don't make this public, so we need to resort to
    // a hack...
    let atoken: string = (this.token.token as any).access_token;

    // Add on our user-identifying parameters.
    let fullParams = {
      token: atoken,
      user: {
        email: "xxx",  // Seems to be ignored?
        timezone: "UTC",
      },
      ...params
    };

    // Make the API call.
    return new Promise<any>((resolve, reject) => {
      outlook.base.makeApiCall(fullParams, (error: any, response: any) => {
        if (error) {
          reject(error);
        } else if (response.statusCode < 200 || response.statusCode >= 300) {
          reject("HTTP error " + response.statusCode +
                 "; body: " + JSON.stringify(response.body));
        } else {
          resolve(response.body);
        }
      });
    });
  }

  /**
   * Get event instances from the user's calendar between the two dates.
   */
  async getEvents(start: moment.Moment, end: moment.Moment) {
    let data = await this.request({
      url: 'https://outlook.office.com/api/v2.0/me/calendarview',
      method: 'GET',
      query: {
        'StartDateTime': dateToOfficeLocal(start),
        'EndDateTime': dateToOfficeLocal(end),
      },
    });

    let events: outlook.Event[] = data.value;
    return events.map(eventFromOffice);
  }

  async scheduleEvent(event: calbase.Event): Promise<boolean> {
    return await this.request({
      url: 'https://outlook.office.com/api/v2.0/me/events',
      method: 'POST',
      payload: {
        'Subject': event.title,
        'Start': {
          'DateTime': dateToOfficeLocal(event.start),
          'TimeZone': 'UTC'
        },
        'End': {
          'DateTime': dateToOfficeLocal(event.end),
          'TimeZone': 'UTC'
        }
      },
    }).then(() => true, () => false);
  }
}
