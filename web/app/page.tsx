import { DayframeApp } from "./dayframe-app";
import { CaptureStartControl } from "./capture-start-control";
import { MissedTaskActions } from "./missed-task-actions";
import { WeekCalendar } from "./week-calendar";
import "./week-calendar.css";

export default function Home() {
  return <><DayframeApp /><CaptureStartControl /><MissedTaskActions /><WeekCalendar /></>;
}
