import { createRoot } from "react-dom/client";
import { DayframeV2 } from "../app/dayframe-v2";
import { MilestoneFeaturedController } from "../app/milestone-featured-controller";
import { RoutineGroupsController } from "../app/routine-groups-controller";
import { ActivityTimeController } from "../app/activity-time-controller";
import { HistoryController } from "../app/history-controller";
import { ExecutionTracker } from "../app/execution-tracker";
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
  </>,
);
