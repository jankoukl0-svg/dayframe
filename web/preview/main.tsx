import { createRoot } from "react-dom/client";
import { DayframeApp } from "../app/dayframe-app";
import { CaptureStartControl } from "../app/capture-start-control";
import { MissedTaskActions } from "../app/missed-task-actions";
import "../app/globals.css";
import "../app/compact-copy.css";

const root = document.getElementById("root");
if (!root) throw new Error("Preview root element was not found.");

createRoot(root).render(
  <>
    <DayframeApp />
    <CaptureStartControl />
    <MissedTaskActions />
  </>,
);
