import { createRoot } from "react-dom/client";
import { DayframeV2 } from "../app/dayframe-v2";
import { MilestoneFeaturedController } from "../app/milestone-featured-controller";
import { RoutineGroupsController } from "../app/routine-groups-controller";
import { ActivityTimeController } from "../app/activity-time-controller";
import { HistoryController } from "../app/history-controller";
import { ReadingOverviewController } from "../app/reading-overview-controller";
import { ReadingMetadataController } from "../app/reading-metadata-controller";
import { ReadingCoverRecoveryController } from "../app/reading-cover-recovery-controller";
import { HistoryPeriodRolloverController } from "../app/history-period-rollover-controller";
import { ExecutionTracker } from "../app/execution-tracker";
import { ActiveCompletionSafetyController } from "../app/active-completion-safety-controller";
import { FocusManualStartController } from "../app/focus-manual-start-controller";
import { WeekCapacityController } from "../app/week-capacity-controller";
import { LabelColorsController } from "../app/label-colors-controller";
import { EditCategoryPreserverController } from "../app/edit-category-preserver-controller";
import { MilestoneColorsController } from "../app/milestone-colors-controller";
import { MonthCalendarController } from "../app/month-calendar-controller";
import { CalendarObservancesController } from "../app/calendar-observances-controller";
import { GoogleCalendarController } from "../app/google-calendar-controller";
import { MonthCalendarCountdownController } from "../app/month-calendar-countdown-controller";
import { RetroactiveWeekController } from "../app/retroactive-week-controller";
import { WeekCrossDayController } from "../app/week-cross-day-controller";
import { WeekDragSafetyController } from "../app/week-drag-safety-controller";
import { TodayTomorrowSafetyController } from "../app/today-tomorrow-safety-controller";
import { PersonalBlockController } from "../app/personal-block-controller";
import { LateReadingController } from "../app/late-reading-controller";
import { FocusWeekSyncController } from "../app/focus-week-sync-controller";
import { HistoryEditController } from "../app/history-edit-controller";
import { NotificationController } from "../app/notification-controller";
import "../app/globals.css";
import "../app/dayframe-v2.css";
import "../app/dayframe-countdowns.css";
import "../app/milestone-alignment.css";
import "../app/week-calendar-polish.css";
import "../app/milestone-featured-controller.css";
import "../app/routine-groups-controller.css";
import "../app/activity-time-controller.css";
import "../app/history-controller.css";
import "../app/history-soft-ui.css";
import "../app/reading-overview-controller.css";
import "../app/reading-metadata-controller.css";
import "../app/reading-cover-sizing.css";
import "../app/overview-title.css";
import "../app/today-polish.css";
import "../app/plan-actual.css";
import "../app/week-capacity.css";
import "../app/label-colors-controller.css";
import "../app/milestone-colors-controller.css";
import "../app/month-calendar-controller.css";
import "../app/calendar-observances-controller.css";
import "../app/google-calendar-controller.css";
import "../app/week-bottom-buffer.css";
import "../app/late-reading-controller.css";
import "../app/notification-controller.css";
import "../app/sidebar-shortcuts.css";
import "../app/visual-harmony.css";
import "../app/visual-harmony-state-fixes.css";
import "../app/week-category-tints.css";
import "../app/retroactive-week-controller.css";
import "../app/personal-block-controller.css";

const root = document.getElementById("root");
if (!root) throw new Error("Preview root element was not found.");

createRoot(root).render(
  <>
    <DayframeV2 />
    <MilestoneFeaturedController />
    <RoutineGroupsController />
    <ActivityTimeController />
    <HistoryController />
    <ReadingOverviewController />
    <ReadingMetadataController />
    <ReadingCoverRecoveryController />
    <HistoryPeriodRolloverController />
    <ExecutionTracker />
    <ActiveCompletionSafetyController />
    <FocusManualStartController />
    <WeekCapacityController />
    <LabelColorsController />
    <EditCategoryPreserverController />
    <MilestoneColorsController />
    <MonthCalendarController />
    <CalendarObservancesController />
    <GoogleCalendarController />
    <MonthCalendarCountdownController />
    <FocusWeekSyncController />
    <HistoryEditController />
    <RetroactiveWeekController />
    <WeekCrossDayController />
    <WeekDragSafetyController />
    <TodayTomorrowSafetyController />
    <PersonalBlockController />
    <LateReadingController />
    <NotificationController />
  </>,
);
