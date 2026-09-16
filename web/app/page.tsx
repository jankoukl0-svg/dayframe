import { DayframeApp } from "./dayframe-app";
import { CaptureStartControl } from "./capture-start-control";
import { MissedTaskActions } from "./missed-task-actions";

export default function Home() {
  return <><DayframeApp /><CaptureStartControl /><MissedTaskActions /></>;
}
