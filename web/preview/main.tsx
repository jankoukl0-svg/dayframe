import { createRoot } from "react-dom/client";
import { DayframeV2 } from "../app/dayframe-v2";
import "../app/globals.css";
import "../app/dayframe-v2.css";
import "../app/dayframe-countdowns.css";
import "../app/week-calendar-polish.css";

const root = document.getElementById("root");
if (!root) throw new Error("Preview root element was not found.");

createRoot(root).render(<DayframeV2 />);
