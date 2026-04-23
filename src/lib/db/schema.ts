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
    source: text("source"), // 'meal-plan' | null — tag so we can filter later
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

// --- Events (user-facing name). Table kept as "holidays" because "events"
// is already taken by the calendar events table. Each item optionally
// references an event_category (household-scoped, user-managed).

export const eventCategories = pgTable(
  "event_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: varchar("color", { length: 7 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("event_categories_household_idx").on(t.householdId),
    uniqueIndex("event_categories_household_name_uniq").on(t.householdId, t.name),
  ]
);

export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    categoryId: uuid("category_id").references(() => eventCategories.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    startsOn: text("starts_on").notNull(), // date-only, stored as YYYY-MM-DD
    endsOn: text("ends_on"), // nullable for single-day
    forPersons: uuid("for_persons").array().notNull().default(sql`'{}'::uuid[]`),
    documentUrl: text("document_url"),
    hasTravel: boolean("has_travel").notNull().default(false),
    pushToCalendar: boolean("push_to_calendar").notNull().default(false),
    externalCalendarEventId: text("external_calendar_event_id"),
    externalCalendarProvider: calendarProviderEnum("external_calendar_provider"),
    externalCalendarId: uuid("external_calendar_id").references(() => calendars.id, {
      onDelete: "set null",
    }),
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("holidays_household_idx").on(t.householdId),
    index("holidays_starts_idx").on(t.startsOn),
    index("holidays_category_idx").on(t.categoryId),
  ]
);

// --- Recipes + meal planning (v2) ---

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    servings: integer("servings").notNull().default(2),
    prepTimeMinutes: integer("prep_time_minutes"),
    cookTimeMinutes: integer("cook_time_minutes"),
    ingredients: jsonb("ingredients").notNull().default([]), // {quantity, unit, name, notes}[]
    instructions: jsonb("instructions").notNull().default([]), // string[]
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    nutritionPerServing: jsonb("nutrition_per_serving"), // {calories, protein, carbs, fat, fiber}
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"),
    cookedCount: integer("cooked_count").notNull().default(0),
    score: integer("score"), // 1-5, household-assigned rating (nullable = not yet rated)
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("recipes_household_idx").on(t.householdId),
    index("recipes_title_idx").on(t.title),
  ]
);

export const recipeFavorites = pgTable(
  "recipe_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recipeId] })]
);

export const mealPlanEntries = pgTable(
  "meal_plan_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    date: text("date").notNull(), // YYYY-MM-DD, dinner-only so no slot enum needed
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    freeText: text("free_text"), // for quick-add meals without a saved recipe
    servings: integer("servings"), // null = use recipe.servings
    // Restaurant fields — a dinner entry is a recipe OR freeText OR a
    // restaurant. When restaurantName is set the entry is a "dining out"
    // plan; reservationAt / menuUrl / address are all optional embellishments.
    restaurantName: text("restaurant_name"),
    restaurantUrl: text("restaurant_url"),
    restaurantMenuUrl: text("restaurant_menu_url"),
    restaurantAddress: text("restaurant_address"),
    reservationAt: timestamp("reservation_at", { withTimezone: true }),
    cookedAt: timestamp("cooked_at", { withTimezone: true }),
    visibility: visibilityEnum("visibility").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("meal_plan_household_idx").on(t.householdId),
    index("meal_plan_date_idx").on(t.date),
  ]
);

// Travel reservations attached to an event (via holidayId). A single event
// can span multiple days and multiple bookings (flight out, hotel, flight
// back, etc.). Kind is a free-form text field — we render different icons
// per known kind but don't constrain at the DB level.
export const travelReservations = pgTable(
  "travel_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    holidayId: uuid("holiday_id")
      .notNull()
      .references(() => holidays.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("other"), // 'hotel' | 'flight' | 'train' | 'car_rental' | 'ferry' | 'transit' | 'other'
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    location: text("location"),
    confirmationCode: text("confirmation_code"),
    referenceUrl: text("reference_url"),
    notes: text("notes"),
    origin: text("origin"),
    destination: text("destination"),
    documentUrl: text("document_url"),
    travelerUserIds: uuid("traveler_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("travel_reservations_household_idx").on(t.householdId),
    index("travel_reservations_holiday_idx").on(t.holidayId),
    index("travel_reservations_range_idx").on(t.startAt, t.endAt),
  ]
);

// iCloud Shared Album config per household — the user pastes the public
// share URL in Settings and we remember the derived token + partition
// base URL so the daily picker doesn't have to re-resolve each run.
export const householdPhotoAlbums = pgTable("household_photo_albums", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  shareUrl: text("share_url").notNull(),
  albumToken: text("album_token").notNull(),
  baseUrl: text("base_url"), // e.g. https://p123-sharedstreams.icloud.com/TOKEN/sharedstreams/
  streamName: text("stream_name"),
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per household per day. The picker inserts a row the first time
// Today page loads each day; subsequent reads just return the cached entry.
// Old rows are retained so we can avoid re-picking guids shown in the last
// ~30 days.
export const photoOfTheDay = pgTable(
  "photo_of_the_day",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    photoGuid: text("photo_guid").notNull(),
    localPath: text("local_path").notNull(), // relative to UPLOAD_ROOT
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    caption: text("caption"),
    contributorName: text("contributor_name"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.date] }),
    index("photo_of_the_day_household_idx").on(t.householdId),
  ]
);

// Dinner absences: rows exist only for (userId, date) pairs where the member
// is NOT eating at home. Absence of a row == at home, so the weekly popup
// just needs to sync the "away" set for next week.
export const dinnerAbsences = pgTable(
  "dinner_absences",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD, applies to that day's dinner
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId, t.date] }),
    index("dinner_absences_household_date_idx").on(t.householdId, t.date),
  ]
);

export const claudeUsage = pgTable(
  "claude_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (user's day, for daily cap)
    callType: text("call_type").notNull(), // 'extract-text' | 'extract-image' | 'extract-social' | 'aggregate'
    success: boolean("success").notNull(),
    inputSizeBytes: integer("input_size_bytes"),
    outputSizeBytes: integer("output_size_bytes"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("claude_usage_user_day_idx").on(t.userId, t.date)]
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
  holidays: many(holidays),
  recipes: many(recipes),
  mealPlanEntries: many(mealPlanEntries),
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

export const holidaysRelations = relations(holidays, ({ one }) => ({
  household: one(households, { fields: [holidays.householdId], references: [households.id] }),
  author: one(users, { fields: [holidays.authorId], references: [users.id] }),
  category: one(eventCategories, {
    fields: [holidays.categoryId],
    references: [eventCategories.id],
  }),
}));

export const eventCategoriesRelations = relations(eventCategories, ({ one, many }) => ({
  household: one(households, {
    fields: [eventCategories.householdId],
    references: [households.id],
  }),
  events: many(holidays),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  household: one(households, { fields: [recipes.householdId], references: [households.id] }),
  author: one(users, { fields: [recipes.authorId], references: [users.id] }),
  favorites: many(recipeFavorites),
}));

export const recipeFavoritesRelations = relations(recipeFavorites, ({ one }) => ({
  user: one(users, { fields: [recipeFavorites.userId], references: [users.id] }),
  recipe: one(recipes, { fields: [recipeFavorites.recipeId], references: [recipes.id] }),
}));

export const mealPlanEntriesRelations = relations(mealPlanEntries, ({ one }) => ({
  household: one(households, { fields: [mealPlanEntries.householdId], references: [households.id] }),
  author: one(users, { fields: [mealPlanEntries.authorId], references: [users.id] }),
  recipe: one(recipes, { fields: [mealPlanEntries.recipeId], references: [recipes.id] }),
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
export type Holiday = typeof holidays.$inferSelect;
export type EventCategory = typeof eventCategories.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type RecipeFavorite = typeof recipeFavorites.$inferSelect;
export type MealPlanEntry = typeof mealPlanEntries.$inferSelect;
export type ClaudeUsage = typeof claudeUsage.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
