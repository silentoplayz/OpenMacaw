import { getConfig } from '../config.js';
import { buildSystemPrompt } from './prompts.js';

export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  status: 'pending' | 'completed' | 'failed';
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  createdAt: Date;
}

export type PipelinePlan = Plan;

export function createPlan(goal: string): Plan {
  return {
    id: crypto.randomUUID(),
    goal,
    steps: [],
    currentStepIndex: 0,
    createdAt: new Date(),
  };
}

export function generatePlanPrompt(_goal: string): string {
  const config = getConfig();
  return `${buildSystemPrompt(config.PERSONALITY)}

You are in PLAN mode. Break down the user's request into a series of specific steps. For each step, identify if a tool is needed.

Format your response as:
## Plan
1. [Step description]
2. [Step description]
...

For each step that requires a tool, format as:
1. [Step description] → TOOL:tool_name(PARAM=value)
`;
}

export function parsePlanFromResponse(response: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const lines = response.split('\n');

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+?)(?:\s+→\s+TOOL:(\w+)\((.+)\))?$/);
    if (match) {
      const [, description, toolName, toolInputStr] = match;
      let toolInput: Record<string, unknown> = {};

      if (toolInputStr) {
        try {
          const params: string[] = toolInputStr.split(',').map(s => s.trim());
          for (const param of params) {
            const [key, value] = param.split('=').map(s => s.trim());
            if (key && value) {
              toolInput[key] = value;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      steps.push({
        id: crypto.randomUUID(),
        description: description.trim(),
        toolName,
        toolInput: toolName ? toolInput : undefined,
        status: 'pending',
      });
    }
  }

  return steps;
}

export function executePlan(
  plan: Plan,
  onStepComplete: (stepIndex: number, result: unknown) => void
): Plan {
  const newPlan = { ...plan, steps: [...plan.steps] };

  for (let i = plan.currentStepIndex; i < newPlan.steps.length; i++) {
    const step = newPlan.steps[i];
    if (step.status === 'completed') continue;

    if (!step.toolName) {
      step.status = 'completed';
      onStepComplete(i, null);
      continue;
    }
  }

  return newPlan;
}

export async function planAsync(_intentId: string, _canaryToken: string, _model: string): Promise<{ success: boolean; data?: any; error?: string; noTask?: boolean }> {
  // Mock implementation for missing PR chunk
  return { success: true, data: { steps: [] } };
}
