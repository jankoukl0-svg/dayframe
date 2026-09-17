import { DayframeApp } from "./dayframe-app";
import { CaptureStartControl } from "./capture-start-control";
import { CaptureResultCleaner } from "./capture-result-cleaner";
import { MissedTaskActions } from "./missed-task-actions";
import { WeekCalendar } from "./week-calendar";
import "./week-calendar.css";

export default function Home() {
  return <><DayframeApp /><CaptureStartControl /><CaptureResultCleaner /><MissedTaskActions /><WeekCalendar /></>;
}
