/**
 * The core behavior for the OPAL bot.
 */

import * as util from 'util';
import { Bot, Conversation } from '../multibot';
import { SlackBot } from '../multibot/slackbot';
import { TerminalBot } from '../multibot/termbot';
import { FacebookBot } from '../multibot/fbbot';
import { WebBot } from "../multibot/webbot";
import { Wit } from 'node-wit';
import * as wit from './wit';
import * as libweb from '../libweb';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as opal from 'opal';
import * as path from 'path';
import fetch from 'node-fetch';
import { findURL, gitSummary, IVars, randomString } from './util';
import * as caldav from '../multical/caldav';
import * as office from '../multical/office';
import * as remote from '../multical/remote';
import { Calendar, Event } from '../multical/calbase';
import * as moment from 'moment';
import * as nunjucks from 'nunjucks';

/**
 * Our data model for keeping track of users' data.
 */
interface User {
  slack_id: string;
  settings: Settings;
}

/**
 * Settings that users can configure in the web interface.
 */
interface Settings {
  service?: 'caldav' | 'office' | 'remote';
  caldav?: {
    url: string;
    username: string;
    password: string;
  };
  officeToken?: office.Token;
  remote?: {
    hostname: string;
    port: number;
  };
}

/**
 * Get a quick text summary of things on a calendar.
 */
async function getSomeEvents(cal: Calendar) {
  let events = await cal.getEvents(moment(), moment().add(7, 'days'));
  let out = [];
  for (let event of events) {
    out.push(`${event.start.format()}: ${event.title}`);
  }
  return out.join('\n');
}

/**
 * The main logic for the Opal bot.
 */
export class OpalBot {
  /**
   * User settings, stored in the database.
   */
  public users: LokiCollection<User>;

  /**
   * Web sessions representing pending requests for settings from the user.
   */
  public webSessions = new IVars<Settings>();

  /**
   * Routes for the web server.
   */
  public webRoutes: libweb.Route[] = [];

  /**
   * Connection for authenticating with the Office 365 API.
   */
  public officeClient: office.Client | null = null;

  constructor(
    public wit: Wit,
    public db: Loki,
    public webURL: string,
    public webdir = 'web',
  ) {
    // trim off trailing slash
    if (this.webURL.endsWith('/')) {
      this.webURL = this.webURL.slice(0, this.webURL.length - 1);
    }

    // Get or create a database collection for users.
    this.users = (db.getCollection("users") ||
      db.addCollection("users")) as LokiCollection<User>;

    // Set up configuration web interface.
    this.webRoutes.push(this.settingsRoute());
  }

  /**
   * The web route for showing and modifying user settings.
   */
  settingsRoute() {
    nunjucks.configure(this.webdir);
    return new libweb.Route('/settings/:token', async (req, res, params) => {
      // Make sure we have a valid token.
      let token = params['token'];
      if (!this.webSessions.has(token)) {
        res.statusCode = 404;
        res.end('invalid token');
        return;
      }

      if (req.method === 'GET') {
        // Send the form.
        let ctx: { [k: string]: string } = {};
        if (this.officeClient) {
          let auth = await this.officeClient.authenticate();
          ctx['officeAuthURL'] = auth.url;
          auth.token.then(t => {
            let settings: Settings = {
              service: 'office',
              officeToken: t,
            };
            this.webSessions.put(token, settings);
          });
        }
        nunjucks.render('settings.html', ctx, (err, rendered) => {
          res.end(rendered);
        });
      } else if (req.method === 'POST') {
        // Retrieve the settings.
        let data = await libweb.formdata(req);
        if (data['service'] === 'caldav') {
          let settings: Settings = {
            service: 'caldav',
            caldav: {
              url: data['url'],
              username: data['username'],
              password: data['password'],
            },
          };
          this.webSessions.put(token, settings);
          res.end('got it; thanks!');
        } else if (data['service'] === 'remote') {
          let settings: Settings = {
            service: 'remote',
            remote: {
              hostname: data['hostname'],
              port: data['port'],
            },
          };
          this.webSessions.put(token, settings);
          res.end('got it; thanks!');
        } else {
          res.end('sorry; I did not understand the form');
        }
      } else {
        libweb.notFound(req, res);
      }
    });
  }

  /**
   * Connect the bot to a Slack team.
   */
  connectSlack(token: string, statusChan: string) {
    let slack = new SlackBot(token);

    // Handle Slack connection.
    slack.on("ready", async () => {
      console.log(`I'm ${slack.self.name} on ${slack.team.name}`);
      let status_channel = slack.channel(statusChan);
      if (status_channel) {
        let commit = await gitSummary(__dirname);
        slack.send(`:wave: @ ${commit}`, status_channel.id);
        slack.send(`Come talk to me at ${this.webURL}/chat`, status_channel.id);
      }
    });

    this.register(slack);
    slack.start();
  }

  /**
   * Run the bot in terminal (debugging) mode.
   */
  runTerminal() {
    let term = new TerminalBot();
    this.register(term);
    term.run();
  }

  /**
   * Add a server component to interact with Facebook Messenger. You still
   * need to call `runWeb` to actually run the server.
   */
  addFacebook(token: string, verify: string) {
    let fb = new FacebookBot(token, verify);
    this.register(fb);
    this.webRoutes.push(new libweb.Route('/fb', fb.handler()));
  }

  /**
   * Add server component for directly interacting with the bot through
   * a Web interface.
   */
  addWeb() {
    let web = new WebBot();
    this.register(web);
    this.webRoutes.push(...web.routes());
  }

  /**
   * Run Web server.
   */
  runWeb(port: number, key?: string, cert?: string, ca?: string): Promise<void> {
    let routes = libweb.dispatch(this.webRoutes);
    let server: http.Server | https.Server;
    if (key && cert && ca) {
      server = https.createServer({
        key: fs.readFileSync(key),
        cert: fs.readFileSync(cert),
        ca: fs.readFileSync(ca),
      }, routes);
    } else {
      server = http.createServer(routes);
    }
    console.log(server);

    return new Promise<void>((resolve, reject) => {
      server.listen(port, () => {
        console.log(`web server running at ${this.webURL}`);
        resolve();
      });
    });
  }

  /**
   * Add support for getting calendars via the Office 365 API.
   */
  addOffice(id: string, secret: string) {
    let client = new office.Client(id, secret, this.webURL);
    this.webRoutes.push(client.authRoute);
    this.officeClient = client;
  }

  /**
   * Register this bot's callbacks with a connection.
   */
  register(bot: Bot) {
    bot.onconverse = async (text, conv) => {
      await this.interact(text, conv);
    };
  }

  /**
   * Get a user from the database, or create it if it doesn't exist.
   */
  getUser(conv: Conversation): User {
    let slack_id = conv.user;  // Currently assuming all users on Slack.
    let user = this.users.findOne({ slack_id }) as User;
    if (user) {
      return user;
    } else {
      let newUser = { slack_id, settings: {} };
      this.users.insert(newUser);
      this.db.saveDatabase();
      return newUser;
    }
  }

  /**
   * Interact with the user to get their settings.
   */
  async gatherSettings(conv: Conversation) {
    let token = randomString();
    conv.send(`please fill out the form at ${this.webURL}/settings/${token}`);
    return await this.webSessions.get(token);
  }

  /**
   * Get the user's configured Calendar. If `force` is enabled or the calendar
   * hasn't been set up, interact with the user to set it up first.
   */
  async getCalendar(conv: Conversation, force=false): Promise<Calendar | null> {
    let user = this.getUser(conv);

    // Get the settings from the user and store them. Unless we're forcing it,
    // skip this step if we already have a configured service.
    if (force || !user.settings.service) {
      let settings = await this.gatherSettings(conv);
      user.settings = settings;
      this.users.update(user);
      this.db.saveDatabase();
    }

    return await this.createCalendarFromSettings(user.settings);
  }

  /**
   * Get the appropriate Calendar object, or null if the settings have
   * not been initialized
   */
  async createCalendarFromSettings(settings: Settings) : Promise<Calendar | null> {
    // Get the calendar from the appropriate service.
    if (settings.service === 'caldav') {
      let cd = settings.caldav!;
      return new caldav.Calendar(cd.url, cd.username, cd.password);
    } else if (settings.service === 'office') {
      let token = settings.officeToken!;
      return new office.Calendar(token);
    } else if (settings.service === 'remote') {
      let rem = settings.remote!;
      return new remote.Calendar(rem.hostname, rem.port);
    } else {
      return null;
    }
  }

  /**
   * Conversation with a greeting intent.
   */
  async handle_greeting(conv: Conversation) {
    conv.send(`hi, ${conv.user}!`);
  }

  /**
   * Conversation where the user says goodbye.
   */
  async handle_bye(conv: Conversation) {
    conv.send(":wave: I'll be right here");
  }

  /**
   * Conversation where the user says thanks.
   */
  async handle_thanks(conv: Conversation) {
    conv.send("nbd yo");
  }

  /**
   * Conversation where the user wants to see their calendar.
   */
  async handle_show_calendar(conv: Conversation) {
    conv.send("let's get your calendar!");
    let calendar = await this.getCalendar(conv);
    if (calendar) {
      conv.send(await getSomeEvents(calendar));
    }
  }

  /**
   * Convenience function for repeatedly querying user for a missing piece of
   *   information, until the user requests to cancel.
   * Returns a wit.Entity on success, or null on failure/cancel
   */
  async query_loop(conv: Conversation, value: wit.Entity | null, prompt: string, entity_tag: string) {
    while (value === null) {
      conv.send(prompt + "\n(\"cancel\" to quit)");
      let response = await conv.recv();

      // sometimes wit dies on us
      let res = await this.wit.message(response, {}).catch((e) => {
        conv.send(`Got an unexpected error: ${e}`);
        return null;
      });
      if (res === null) {
        return null;
      }
      if (wit.entityValue(res, "intent") === "cancel") {
        conv.send("Alright, giving up");
        return null;
      }
      value = wit.getEntity(res, entity_tag);
    }
    return value;
  }

  /**
   * Conversation where the user wants to schedule a meeting.
   */
  async handle_schedule_meeting(conv: Conversation,
                                datetime_ent: wit.Entity | null,
                                slack_id_ent: wit.Entity | null,
                                duration_ent: wit.Entity | null,
                               ) {
    // set up conv user and calendar
    let me = this.getUser(conv);
    let myCalendar = await this.createCalendarFromSettings(me.settings);
    if (myCalendar === null) {
      conv.send("You don't have any calendars set up!");
      return;
    }

    // find the target user for the meeting
    slack_id_ent = await this.query_loop(conv, slack_id_ent, "Who did you want to schedule that meeting with?", "contact");
    if (slack_id_ent === null) {
      return;
    }
    let slack_id = slack_id_ent.value;
    let target = this.users.findOne({ slack_id }) as User;
    if (!target) {
      conv.send(`I couldn't find any users named ${slack_id}!`);
      return;
    }
    let targetCalendar = await this.createCalendarFromSettings(target.settings);
    if (targetCalendar === null) {
      conv.send(`${target.slack_id} doesn't have any calendars set up!`);
      return;
    }

    // get the date and duration of the meeting
    datetime_ent = await this.query_loop(conv, datetime_ent, "When did you want to schedule that meeting?", "datetime");
    if (datetime_ent === null) {
      return;
    }
    let datetime = datetime_ent.value;
    duration_ent = await this.query_loop(conv, duration_ent, "How long should the meeting be?", "duration");
    if (duration_ent === null) {
      return;
    }
    let duration = moment.duration(duration_ent.normalized.value, duration_ent.normalized.unit);

    // set up the event to be scheduled
    conv.send(`Scheduling an ${duration} meeting at ${datetime} with ${target.slack_id}`);
    let start_time = moment(datetime);
    let ctx = opal.ctx;
    let event: Event = {
      title: `Opal-Scheduled event with ${me.slack_id} and ${target.slack_id}`,
      start: start_time,
      end: start_time.clone().add(duration),
    };

    // hypothetical execution of scheduling, to make sure we only schedule
    //  atomically, if the proposed time works for both people
    out succeeded;
    let world = hyp of {
      let myScheduleSuccessP = myCalendar!.scheduleEvent(event);
      let targetScheduleSuccessP = targetCalendar!.scheduleEvent(event);
      let promises = Promise.all([myScheduleSuccessP, targetScheduleSuccessP])
        .then(([m, t]) => {
          return m && t;
        }, (e) => {
          conv.send(`Issue scheduling: ${e}`);
          return false;
        });
      succeeded = await promises;
    };

    // check both that scheduling succeeded and the commit succeeded
    let succeeded_bool = await ctx.get(succeeded, world);
    if (succeeded_bool) {
      await ctx.commit(world).then(
        () => conv.send("Got it."),
        (e) => conv.send(`Failed to commit the meeting to both calendars: ${e}`)
      );
    } else {
      conv.send("Could not schedule a meeting on both calendars.");
    }
  }

  /**
   * Conversation where the user wants to set up their calendar settings.
   */
  async handle_setup_calendar(conv: Conversation) {
    await this.getCalendar(conv, true);
    conv.send("ok, all set!");
  }

  /**
   * Conversation where the user wants to set up their calendar settings.
   */
  async handle_who(conv: Conversation) {
    let users = this.users.mapReduce((item: User) => item.slack_id, (ids: string[]) => ids.join(', '));
    if (users.length == 0) {
      conv.send("No users set up!");
    } else {
      conv.send("Here are all the users I know about:");
      conv.send(users);
    }
  }

  /**
   * Conversation where the user asks for help using the bot.
   */
  async handle_help(conv: Conversation) {
    conv.send("I can schedule a meeting or show your calendar");
  }

  /**
   * Response sent when no other response is appropriate
   */
  private default_response : string = ':confused: :grey_question:';

  /**
   * Called when a conversation has a missing or unrecognized intent.
   */
  async handle_default(conv: Conversation) {
    conv.send(this.default_response);
  }

  /**
   * Handle a new conversation by dispatching based on intent.
   */
  async interact(text: string, conv: Conversation) {
    if (text.trim() === '') {
      // if no message was sent, don't even try to parse it
      return;
    } else if (text.trim() === this.default_response) {
      // don't respond to another bot being confused
      return;
    }

    let res = await this.wit.message(text, {});
    console.log(`Wit parse: ${util.inspect(res, { depth: undefined })}`);

    let unhandled = false;
    if (wit.getEntity(res, "greetings")) {
      await this.handle_greeting(conv);
    } else if (wit.getEntity(res, "bye")) {
      await this.handle_bye(conv);
    } else if (wit.getEntity(res, "thanks")) {
      await this.handle_thanks(conv);
    } else {
      let intent = wit.entityValue(res, "intent");
      if (intent === "show_calendar") {
        await this.handle_show_calendar(conv);
      } else if (intent === "schedule_meeting") {
        let datetime = wit.getEntity(res, "datetime");
        let contact = wit.getEntity(res, "contact");
        let duration = wit.getEntity(res, "duration");
        await this.handle_schedule_meeting(conv, datetime, contact, duration);
      } else if (intent === "setup_calendar") {
        await this.handle_setup_calendar(conv);
      } else if (intent === "help") {
        await this.handle_help(conv);
      } else if (intent === "who") {
        await this.handle_who(conv);
      } else {
        await this.handle_default(conv);
      }
    }
  }
}
