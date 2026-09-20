import type { Metadata } from "next";
import "./globals.css";
import "./milestone-featured-controller.css";
import "./routine-groups-controller.css";
import "./activity-time-controller.css";
import "./history-controller.css";
import "./today-polish.css";
import { MilestoneFeaturedController } from "./milestone-featured-controller";
import { RoutineGroupsController } from "./routine-groups-controller";
import { ActivityTimeController } from "./activity-time-controller";
import { HistoryController } from "./history-controller";

export const metadata: Metadata = {
  title: "Dayframe — dnešek má svůj plán",
  description: "Dnešní plán, týdenní kalendář, soustředění a důležité termíny v jednom klidném pracovním prostoru.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="cs"><body>{children}<MilestoneFeaturedController /><RoutineGroupsController /><ActivityTimeController /><HistoryController /></body></html>;
}
