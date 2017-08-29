/**
 * Parameters for an OData query.
 *
 * (Surely there are more possible fields, but these are a few that work
 * here.)
 */
export interface ODataParams {
  '$select'?: string;
  '$orderby'?: string;
  '$top'?: number;
}

/**
 * Identifies an Office 365 user.
 */
export interface User {
  email: string;
  timezone: string;
}

/**
 * Parameters for raw API calls.
 */
export interface APICallParams {
  url: string;
  token: string;
  user: User;
  method: string;
  query: { [key: string]: string };
  payload: { [key: string]: string } | string;
  headers: { [key: string]: string } | string;
}

/**
 * Used to represent people in calendar events.
 */
export interface EmailAddress {
  Name: string;
  Address: string;
}

/**
 * Dates in the API responses.
 */
export interface DateTime {
  DateTime: string;
  TimeZone: string;
}

/**
 * The type for calendar events returned from the API.
 */
export interface Event {
  Id: string;
  CreatedDateTime: string;
  LastModifiedDateTime: string;
  ChangeKey: string;
  Categories: any[],
  OriginalStartTimeZone: string;
  OriginalEndTimeZone: string;
  iCalUId: string;
  ReminderMinutesBeforeStart: number;
  IsReminderOn: boolean;
  HasAttachments: boolean;
  Subject: string;
  BodyPreview: string;
  Importance: string;
  Sensitivity: string;
  IsAllDay: boolean;
  IsCancelled: boolean;
  IsOrganizer: boolean;
  ResponseRequested: boolean;
  SeriesMasterId: string;
  ShowAs: string;
  Type: string;
  WebLink: string;
  OnlineMeetingUrl: string | null;
  ResponseStatus: { Response: string, Time: string };
  Body: { ContentType: string, Content: string };
  Start: DateTime;
  End: DateTime;
  Location: { DisplayName: string };
  Recurrence: any;
  Attendees: { Type: string, Status: any, EmailAddress: EmailAddress }[];
  Organizer: { EmailAddress: EmailAddress }
}

export module calendar {
  /**
   * Get events from a user's calendar.
   */
  export function getEvents(
    parameters: {
      token: string,
      user: User,
      odataParams: ODataParams,
    },
    callback: (error: any, result: any) => void
  ): void;
}

export module base {
  /**
   * Central API invocation function.
   */
  export function makeApiCall(
    parameters: APICallParams,
    callback: (error: any, response: any) => void,
  ): void;
}
