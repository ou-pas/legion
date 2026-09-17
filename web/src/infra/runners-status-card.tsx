import { Zap } from "lucide-react";
import type { InfraRunner } from "../api/infra.js";
import { Caption, Label, Text } from "../ui/text.js";
import { RunnerHealthChip } from "./runner-health.js";
import { INFRA_TEXT } from "./text.js";
import "./runners-status-card.css";

export function RunnersStatusCard({
  runners,
  onNavigate,
}: {
  runners: InfraRunner[];
  onNavigate: () => void;
}) {
  const healthy = runners.filter((r) => r.available && r.image.present).length;
  const degraded = runners.length - healthy;

  return (
    <div className="runners-status-card">
      <Label className="runners-status-title">{INFRA_TEXT.statusCard.title}</Label>
      <div className="runners-status-list">
        {runners.map((r) => (
          <div key={r.runnerId} className="runners-status-row">
            <div className="runners-status-content">
              <Text className="runners-status-name">{r.runnerName}</Text>
              <Caption className="runners-status-load">
                {INFRA_TEXT.statusCard.load(r.running, r.maxConcurrentSessions)}
              </Caption>
            </div>
            <RunnerHealthChip available={r.available} />
          </div>
        ))}
      </div>
      {degraded > 0 && (
        <Caption className="runners-status-warning">
          <Zap className="icon" />
          {INFRA_TEXT.statusCard.degraded(degraded)}
        </Caption>
      )}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onNavigate();
        }}
        className="runners-status-action"
      >
        {INFRA_TEXT.statusCard.open}
      </a>
    </div>
  );
}
