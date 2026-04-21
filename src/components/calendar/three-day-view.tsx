"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// react-big-calendar's TimeGrid isn't publicly typed; this file wraps it.

import * as React from "react";
import { Navigate } from "react-big-calendar";
// @ts-expect-error: internal rbc export, no types published
import TimeGrid from "react-big-calendar/lib/TimeGrid";
import { addDays, format as fmt } from "date-fns";

type ThreeDayViewProps = {
  date: Date;
  [key: string]: any;
};

type ThreeDayViewComponent = React.FC<ThreeDayViewProps> & {
  range: (date: Date) => Date[];
  navigate: (date: Date, action: keyof typeof Navigate | string) => Date;
  title: (date: Date) => string;
};

const range = (date: Date): Date[] => [date, addDays(date, 1), addDays(date, 2)];

export const ThreeDayView: ThreeDayViewComponent = ((props: ThreeDayViewProps) => {
  const { date, ...rest } = props;
  return <TimeGrid {...(rest as any)} range={range(date)} eventOffset={15} />;
}) as ThreeDayViewComponent;

ThreeDayView.range = range;

ThreeDayView.navigate = (date: Date, action: keyof typeof Navigate | string) => {
  switch (action) {
    case Navigate.PREVIOUS:
      return addDays(date, -3);
    case Navigate.NEXT:
      return addDays(date, 3);
    default:
      return date;
  }
};

ThreeDayView.title = (date: Date) => {
  const end = addDays(date, 2);
  return `${fmt(date, "d MMM")} – ${fmt(end, "d MMM yyyy")}`;
};
