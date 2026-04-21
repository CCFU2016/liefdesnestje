import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  primaryKey,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// All timestamps are UTC. Display timezone is per-event metadata.

export const visibilityEnum = pgEnum("visibility", ["private", "shared"]);
export const householdRoleEnum = pgEnum("household_role", ["owner", "member"]);
export const calendarProviderEnum = pgEnum("calendar_provider", ["google", "microsoft"]);
export const tripItemTypeEnum = pgEnum("trip_item_type", ["flight", "hotel", "activity", "document"]);

// --- Auth.js core tables (matches @auth/drizzle-adapter expectations) ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
);

// --- Households ---

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const householdMembers = pgTable(
  "household_members",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    role: householdRoleEnum("role").notNull().default("member"),
    displayName: text("display_name").notNull(),
    color: varchar("color", { length: 7 }).notNull(), // hex, e.g. #4f46e5
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.householdId] }),
    uniqueIndex("household_color_unique").on(t.householdId, t.color),
    index("household_members_household_idx").on(t.householdId),
  ]
);

export const householdInvites = pgTable(
  "household_invites",
  {
    token: text("token").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invites_household_idx").on(t.householdId)]
);

// --- External calendar accounts (OAuth tokens encrypted at rest) ---

export const externalCalendarAccounts = pgTable(
  "external_calendar_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: calendarProviderEnum("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(), // email or tenant-scoped id
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ext_account_unique").on(t.provider, t.externalAccountId)]
);

export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // OAuth calendars: accountId set, householdId null (derived via account).
    // ICS subscriptions:   accountId null, householdId set, icsUrl set.
    accountId: uuid("account_id").references(() => externalCalendarAccounts.id, { onDelete: "cascade" }),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 16 }).notNull().default("oauth"), // 'oauth' | 'ics'
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    color: varchar("color", { length: 7 }),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    showOnToday: boolean("show_on_today").notNull().default(true),
    deltaLink: text("delta_link"), // Microsoft Graph delta token
    syncToken: text("sync_token"), // Google Calendar sync token
    subscriptionId: text("subscription_id"), // webhook subscription / channel id
    subscriptionResourceId: text("subscription_resource_id"), // Google: needed to stop a channel
    subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
    icsUrl: text("ics_url"),
    icsEtag: text("ics_etag"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("calendar_external_unique").on(t.accountId, t.externalId)]
);

// --- Events ---

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id").references(() => calendars.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    timezone: text("timezone").notNull().default("UTC"),
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    externalId: text("external_id"), // id in source calendar (Graph/Google)
    etag: text("etag"),
    recurrenceRule: text("recurrence_rule"), // RRULE for app-native recurring events
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("events_household_idx").on(t.householdId),
    index("events_range_idx").on(t.startsAt, t.endsAt),
    uniqueIndex("event_external_unique").on(t.calendarId, t.externalId),
  ]
);

// --- Todos ---

export const todoLists = pgTable(
  "todo_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("todo_lists_household_idx").on(t.householdId)]
);

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => todoLists.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    assigneeId: uuid("assignee_id").references(() => users.id),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    recurrenceRule: text("recurrence_rule"), // RFC 5545 RRULE
    recurrenceParentId: uuid("recurrence_parent_id").references((): AnyPgColumn => todos.id, {
      onDelete: "set null",
    }),
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("todos_list_idx").on(t.listId),
    index("todos_due_idx").on(t.dueAt),
  ]
);

// --- Notes ---

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull().default("Untitled"),
    contentJson: jsonb("content_json").notNull().default({}),
    contentText: text("content_text").notNull().default(""), // plain-text shadow for FTS
    pinned: boolean("pinned").notNull().default(false),
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("notes_household_idx").on(t.householdId),
    // Postgres full-text search over contentText — generated column set up via migration SQL.
    index("notes_fts_idx").using("gin", sql`to_tsvector('simple', ${t.contentText})`),
  ]
);

// --- Trips (schema only in v1, pages stubbed) ---

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    destination: text("destination"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    coverImageUrl: text("cover_image_url"),
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("trips_household_idx").on(t.householdId)]
);

export const tripItems = pgTable(
  "trip_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    type: tripItemTypeEnum("type").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    details: jsonb("details").notNull().default({}),
    attachmentUrl: text("attachment_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("trip_items_trip_idx").on(t.tripId)]
);

// --- Notifications (in-app) ---

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)]
);

// --- Relations ---

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(householdMembers),
  calendarAccounts: many(externalCalendarAccounts),
}));

export const householdsRelations = relations(households, ({ many }) => ({
  members: many(householdMembers),
  events: many(events),
  todoLists: many(todoLists),
  notes: many(notes),
  trips: many(trips),
  invites: many(householdInvites),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  user: one(users, { fields: [householdMembers.userId], references: [users.id] }),
  household: one(households, { fields: [householdMembers.householdId], references: [households.id] }),
}));

export const calendarsRelations = relations(calendars, ({ one, many }) => ({
  account: one(externalCalendarAccounts, {
    fields: [calendars.accountId],
    references: [externalCalendarAccounts.id],
  }),
  events: many(events),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  household: one(households, { fields: [events.householdId], references: [households.id] }),
  calendar: one(calendars, { fields: [events.calendarId], references: [calendars.id] }),
  author: one(users, { fields: [events.authorId], references: [users.id] }),
}));

export const todoListsRelations = relations(todoLists, ({ one, many }) => ({
  household: one(households, { fields: [todoLists.householdId], references: [households.id] }),
  todos: many(todos),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  list: one(todoLists, { fields: [todos.listId], references: [todoLists.id] }),
  author: one(users, { fields: [todos.authorId], references: [users.id] }),
  assignee: one(users, { fields: [todos.assigneeId], references: [users.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  household: one(households, { fields: [notes.householdId], references: [households.id] }),
  author: one(users, { fields: [notes.authorId], references: [users.id] }),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  household: one(households, { fields: [trips.householdId], references: [households.id] }),
  author: one(users, { fields: [trips.authorId], references: [users.id] }),
  items: many(tripItems),
}));

export const tripItemsRelations = relations(tripItems, ({ one }) => ({
  trip: one(trips, { fields: [tripItems.tripId], references: [trips.id] }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type Household = typeof households.$inferSelect;
export type HouseholdMember = typeof householdMembers.$inferSelect;
export type ExternalCalendarAccount = typeof externalCalendarAccounts.$inferSelect;
export type Calendar = typeof calendars.$inferSelect;
export type Event = typeof events.$inferSelect;
export type TodoList = typeof todoLists.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type TripItem = typeof tripItems.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
