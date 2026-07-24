/**
 * Subagent detection and orchestration
 * Automatically suggests and spawns subagents for complex multi-part tasks
 */

/**
 * Keywords that indicate multi-part tasks suitable for subagent delegation
 */
const SUBAGENT_TRIGGERS = [
  'and',
  'also',
  '&',
  'plus',
  'additionally',
  'furthermore',
  'moreover',
  'in addition',
  'alongside',
  'along with',
  'plus also',
  'in parallel',
  'simultaneously',
  'at the same time',
];

/**
 * Complexity indicators that suggest breaking down into subagents
 */
const COMPLEXITY_INDICATORS = [
  'multiple', 'several', 'various',
  'both', 'three', 'different',
  'refactor', 'restructure', 'reorganize',
  'optimize', 'improve', 'enhance',
  'add', 'create', 'implement',
  'integrate', 'connect', 'combine',
];

/**
 * Analyze a user request to determine if it should be split into subagents
 * Returns list of suggested sub-tasks
 */
export function detectSubagentTasks(userRequest: string): string[] {
  const lowerRequest = userRequest.toLowerCase();
  const subTasks: string[] = [];

  // Check if request contains multi-part indicators
  const hasMultiPart = SUBAGENT_TRIGGERS.some(trigger => lowerRequest.includes(trigger));

  if (!hasMultiPart) {
    return [];
  }

  // Split on key conjunction points
  let parts = lowerRequest
    .split(/\s+and\s+|,\s+also\s+|\s+\+\s+|;\s+/i)
    .map(p => p.trim())
    .filter(p => p.length > 10);

  if (parts.length <= 1) {
    return [];
  }

  // Extract meaningful task descriptions from parts
  for (const part of parts) {
    const task = cleanTaskDescription(part);
    if (task && task.length > 8) {
      subTasks.push(task);
    }
  }

  // If we extracted meaningful tasks and have multiple, suggest subagents
  return subTasks.length >= 2 ? subTasks : [];
}

/**
 * Clean and standardize a task description
 */
function cleanTaskDescription(text: string): string {
  return text
    .replace(/^(please\s+|can\s+you\s+)?/i, '')
    .replace(/[.,!?;:]+$/g, '')
    .trim()
    .split(' ')
    .slice(0, 12) // Limit to ~12 words
    .join(' ');
}

/**
 * Estimate task complexity to determine if parallel execution is beneficial
 */
export function estimateTaskComplexity(description: string): 'low' | 'medium' | 'high' {
  const lowerDesc = description.toLowerCase();
  let complexity = 0;

  // Count complexity indicators
  COMPLEXITY_INDICATORS.forEach(indicator => {
    if (lowerDesc.includes(indicator)) {
      complexity++;
    }
  });

  // Count code-related keywords
  const codeKeywords = [
    'component', 'function', 'function', 'module', 'test', 'doc',
    'import', 'export', 'class', 'interface', 'type',
  ];
  codeKeywords.forEach(keyword => {
    if (lowerDesc.includes(keyword)) {
      complexity += 2;
    }
  });

  // Length-based complexity
  const wordCount = description.split(/\s+/).length;
  if (wordCount > 30) complexity += 2;
  if (wordCount > 50) complexity += 2;

  return complexity >= 5 ? 'high' : complexity >= 2 ? 'medium' : 'low';
}

/**
 * Format a task description for subagent delegation
 * Ensures tasks are self-contained and understandable
 */
export function formatSubagentPrompt(originalRequest: string, taskDescription: string): string {
  return `As part of a larger request, please complete this task:

${taskDescription}

Context: This is part of a multi-step request where different sub-agents handle independent parts in parallel.
Please work independently and provide a complete solution for this specific task.`;
}

/**
 * Estimate how many subagents would be beneficial for a task
 * Returns recommended number of parallel subagents (1-4)
 */
export function recommendedSubagentCount(tasks: string[]): number {
  const MAX_CONCURRENT = 4;
  const baseCount = Math.min(tasks.length, MAX_CONCURRENT);

  if (baseCount === 1) return 1;
  if (baseCount === 2) return 2;
  if (baseCount === 3) return 2; // Use 2 agents for 3 tasks for efficiency
  return 3; // 4+ tasks -> 3 subagents
}

/**
 * Check if a request should use subagents based on complexity and content
 */
export function shouldUseSubagents(userRequest: string): boolean {
  const detectedTasks = detectSubagentTasks(userRequest);

  if (detectedTasks.length < 2) {
    return false;
  }

  // Check if any task is complex enough to warrant subagent
  const hasComplexTask = detectedTasks.some(
    task => estimateTaskComplexity(task) === 'high'
  );

  return hasComplexTask || detectedTasks.length >= 3;
}

/**
 * Group related tasks together for more efficient subagent execution
 */
export function groupRelatedTasks(tasks: string[]): string[][] {
  if (tasks.length <= 2) {
    return tasks.map(t => [t]);
  }

  const groups: string[][] = [];
  const keywords = extractKeywords(tasks);

  // Simple keyword-based grouping
  for (const task of tasks) {
    let addedToGroup = false;

    for (const group of groups) {
      const groupKeywords = extractKeywords(group);
      const overlap = keywords.filter((kw: string) =>
        groupKeywords.includes(kw) && task.toLowerCase().includes(kw)
      );

      if (overlap.length > 0) {
        group.push(task);
        addedToGroup = true;
        break;
      }
    }

    if (!addedToGroup) {
      groups.push([task]);
    }
  }

  return groups;
}

/**
 * Extract meaningful keywords from task descriptions
 */
function extractKeywords(tasks: string[]): string[] {
  const keywords: Set<string> = new Set();

  const KEYWORDS = [
    'component', 'function', 'test', 'doc', 'style', 'type',
    'refactor', 'optimize', 'add', 'create', 'implement',
    'fix', 'bug', 'feature', 'ui', 'api',
  ];

  for (const task of tasks) {
    const lowerTask = task.toLowerCase();
    KEYWORDS.forEach(keyword => {
      if (lowerTask.includes(keyword)) {
        keywords.add(keyword);
      }
    });
  }

  return Array.from(keywords);
}

/**
 * Generate progress messages for subagent execution
 */
export function getProgressMessage(
  currentTaskIndex: number,
  totalTasks: number,
  status: 'queued' | 'running' | 'complete' | 'error'
): string {
  const progress = Math.round((currentTaskIndex / totalTasks) * 100);

  switch (status) {
    case 'queued':
      return `Task ${currentTaskIndex + 1}/${totalTasks} queued (${progress}%)`;
    case 'running':
      return `Task ${currentTaskIndex + 1}/${totalTasks} running... (${progress}%)`;
    case 'complete':
      return `Task ${currentTaskIndex + 1}/${totalTasks} complete (${progress}%)`;
    case 'error':
      return `Task ${currentTaskIndex + 1}/${totalTasks} encountered an error`;
  }
}
