import { createRoot } from "react-dom/client";
import { DayframeV2 } from "../app/dayframe-v2";
import { MilestoneFeaturedController } from "../app/milestone-featured-controller";
import { RoutineGroupsController } from "../app/routine-groups-controller";
import { ActivityTimeController } from "../app/activity-time-controller";
import { HistoryController } from "../app/history-controller";
import { ExecutionTracker } from "../app/execution-tracker";
import { WeekCapacityController } from "../app/week-capacity-controller";
import { WeeklyReviewController } from "../app/weekly-review-controller";
import { LabelColorsController } from "../app/label-colors-controller";
import { MilestoneColorsController } from "../app/milestone-colors-controller";
import { MonthCalendarController } from "../app/month-calendar-controller";
import { MonthCalendarCountdownController } from "../app/month-calendar-countdown-controller";
import { LateReadingController } from "../app/late-reading-controller";
import { FocusWeekSyncController } from "../app/focus-week-sync-controller";
import "../app/globals.css";
import "../app/dayframe-v2.css";
import "../app/dayframe-countdowns.css";
import "../app/milestone-alignment.css";
import "../app/week-calendar-polish.css";
import "../app/milestone-featured-controller.css";
import "../app/routine-groups-controller.css";
import "../app/activity-time-controller.css";
import "../app/history-controller.css";
import "../app/today-polish.css";
import "../app/plan-actual.css";
import "../app/week-capacity.css";
import "../app/weekly-review.css";
import "../app/label-colors-controller.css";
import "../app/milestone-colors-controller.css";
import "../app/month-calendar-controller.css";
import "../app/week-bottom-buffer.css";
import "../app/late-reading-controller.css";

const root = document.getElementById("root");
if (!root) throw new Error("Preview root element was not found.");

createRoot(root).render(
  <>
    <DayframeV2 />
    <MilestoneFeaturedController />
    <RoutineGroupsController />
    <ActivityTimeController />
    <HistoryController />
    <ExecutionTracker />
    <WeekCapacityController />
    <WeeklyReviewController />
    <LabelColorsController />
    <MilestoneColorsController />
    <MonthCalendarController />
    <MonthCalendarCountdownController />
    <FocusWeekSyncController />
    <LateReadingController />
  </>,
);
