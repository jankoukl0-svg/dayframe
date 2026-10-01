import type { Metadata } from "next";
import "./globals.css";
import "./milestone-featured-controller.css";
import "./routine-groups-controller.css";
import "./activity-time-controller.css";
import "./history-controller.css";
import "./history-soft-ui.css";
import "./reading-overview-controller.css";
import "./reading-metadata-controller.css";
import "./overview-title.css";
import "./today-polish.css";
import "./plan-actual.css";
import "./week-capacity.css";
import "./label-colors-controller.css";
import "./milestone-colors-controller.css";
import "./month-calendar-controller.css";
import "./calendar-observances-controller.css";
import "./google-calendar-controller.css";
import "./week-bottom-buffer.css";
import "./late-reading-controller.css";
import "./notification-controller.css";
import "./sidebar-shortcuts.css";
import "./visual-harmony.css";
import "./visual-harmony-state-fixes.css";
import "./week-category-tints.css";
import "./retroactive-week-controller.css";
import "./personal-block-controller.css";
import { MilestoneFeaturedController } from "./milestone-featured-controller";
import { RoutineGroupsController } from "./routine-groups-controller";
import { ActivityTimeController } from "./activity-time-controller";
import { HistoryController } from "./history-controller";
import { ReadingOverviewController } from "./reading-overview-controller";
import { ReadingMetadataController } from "./reading-metadata-controller";
import { HistoryPeriodRolloverController } from "./history-period-rollover-controller";
import { ExecutionTracker } from "./execution-tracker";
import { ActiveCompletionSafetyController } from "./active-completion-safety-controller";
import { FocusManualStartController } from "./focus-manual-start-controller";
import { WeekCapacityController } from "./week-capacity-controller";
import { LabelColorsController } from "./label-colors-controller";
import { MilestoneColorsController } from "./milestone-colors-controller";
import { MonthCalendarController } from "./month-calendar-controller";
import { CalendarObservancesController } from "./calendar-observances-controller";
import { GoogleCalendarController } from "./google-calendar-controller";
import { MonthCalendarCountdownController } from "./month-calendar-countdown-controller";
import { RetroactiveWeekController } from "./retroactive-week-controller";
import { WeekCrossDayController } from "./week-cross-day-controller";
import { WeekDragSafetyController } from "./week-drag-safety-controller";
import { TodayTomorrowSafetyController } from "./today-tomorrow-safety-controller";
import { LateReadingController } from "./late-reading-controller";
import { FocusWeekSyncController } from "./focus-week-sync-controller";
import { HistoryEditController } from "./history-edit-controller";
import { NotificationController } from "./notification-controller";
import { EditCategoryPreserverController } from "./edit-category-preserver-controller";
import { PersonalBlockController } from "./personal-block-controller";

export const metadata: Metadata = {
  title: "Dayframe — dnešek má svůj plán",
  description: "Dnešní plán, týdenní kalendář, soustředění a důležité termíny v jednom klidném pracovním prostoru.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="cs"><body>{children}<MilestoneFeaturedController /><RoutineGroupsController /><ActivityTimeController /><HistoryController /><ReadingOverviewController /><ReadingMetadataController /><HistoryPeriodRolloverController /><ExecutionTracker /><ActiveCompletionSafetyController /><FocusManualStartController /><WeekCapacityController /><LabelColorsController /><EditCategoryPreserverController /><MilestoneColorsController /><MonthCalendarController /><CalendarObservancesController /><GoogleCalendarController /><MonthCalendarCountdownController /><FocusWeekSyncController /><HistoryEditController /><RetroactiveWeekController /><WeekCrossDayController /><WeekDragSafetyController /><TodayTomorrowSafetyController /><PersonalBlockController /><LateReadingController /><NotificationController /></body></html>;
}
