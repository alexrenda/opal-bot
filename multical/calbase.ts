/**
 * Base structures common to any calendar API backend.
 */
import { Moment } from 'moment';

/**
 * A calendar event.
 */
export interface Event {
  title: string;
  start: Moment;
  end: Moment;
}

/**
 * A set of calendar events.
 */
export interface Calendar {
  getEvents(start: Moment, end: Moment): Promise<Event[]>;
  scheduleEvent(event: Event): Promise<boolean>;
}
