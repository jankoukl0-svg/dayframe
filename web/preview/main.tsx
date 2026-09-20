import { createRoot } from "react-dom/client";
import { DayframeV2 } from "../app/dayframe-v2";
import { MilestoneFeaturedController } from "../app/milestone-featured-controller";
import { RoutineGroupsController } from "../app/routine-groups-controller";
import "../app/globals.css";
import "../app/dayframe-v2.css";
import "../app/dayframe-countdowns.css";
import "../app/week-calendar-polish.css";
import "../app/milestone-featured-controller.css";
import "../app/routine-groups-controller.css";

const root = document.getElementById("root");
if (!root) throw new Error("Preview root element was not found.");

createRoot(root).render(
  <>
    <DayframeV2 />
    <MilestoneFeaturedController />
    <RoutineGroupsController />
  </>,
);
