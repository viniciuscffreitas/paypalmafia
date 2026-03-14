import { LinearClient } from '@linear/sdk';
import { createLogger } from '../core/logger';

const logger = createLogger('linear-status');

export interface LinearProjectStatus {
  team: {
    name: string;
    key: string;
    memberCount: number;
  };
  members: {
    name: string;
    displayName: string;
    email: string | null;
    active: boolean;
  }[];
  issuesByState: {
    state: string;
    type: string; // backlog, unstarted, started, completed, canceled
    count: number;
    issues: {
      identifier: string;
      title: string;
      priority: number;
      priorityLabel: string;
      assignee: string | null;
      estimate: number | null;
      dueDate: string | null;
      url: string;
      labels: string[];
      createdAt: string;
      updatedAt: string;
    }[];
  }[];
  activeCycle: {
    name: string;
    number: number;
    startsAt: string;
    endsAt: string;
    progress: number;
    scopeTotal: number;
    scopeCompleted: number;
    issuesTotal: number;
    issuesCompleted: number;
    issuesInProgress: number;
    completedScopeHistory: number[];
    scopeHistory: number[];
  } | null;
  upcomingCycle: {
    name: string;
    number: number;
    startsAt: string;
    endsAt: string;
  } | null;
  projects: {
    name: string;
    state: string;
    progress: number;
    url: string;
    lead: string | null;
    targetDate: string | null;
    milestones: {
      name: string;
      targetDate: string | null;
      sortOrder: number;
    }[];
  }[];
  labels: {
    name: string;
    color: string;
    issueCount: number;
  }[];
  velocity: {
    completedLastWeek: number;
    completedThisWeek: number;
    avgPointsPerCycle: number;
  };
  blockers: {
    identifier: string;
    title: string;
    assignee: string | null;
    daysSinceUpdate: number;
    url: string;
  }[];
}

export async function fetchLinearProjectStatus(
  teamKey: string,
  apiKey: string,
): Promise<LinearProjectStatus | null> {
  if (!teamKey || !apiKey) return null;

  try {
    const client = new LinearClient({ apiKey });

    const teams = await client.teams({ filter: { key: { eq: teamKey } } });
    const team = teams.nodes[0];
    if (!team) {
      logger.warn(`Linear team ${teamKey} not found`);
      return null;
    }

    // Parallel fetch all data from the team
    const [
      issues,
      states,
      cycles,
      members,
      teamProjects,
      labels,
    ] = await Promise.all([
      team.issues({ first: 100 }),
      team.states(),
      team.cycles({ first: 10, orderBy: (('createdAt' as any)) }),
      team.members(),
      team.projects(),
      team.labels(),
    ]);

    // Build state map: stateId -> { name, type }
    const stateMap = new Map<string, { name: string; type: string }>();
    for (const s of states.nodes) {
      stateMap.set(s.id, { name: s.name, type: s.type });
    }

    // Process issues by state
    const issuesByStateMap = new Map<string, LinearProjectStatus['issuesByState'][0]>();
    const now = Date.now();

    const blockers: LinearProjectStatus['blockers'] = [];

    for (const issue of issues.nodes) {
      const state = await issue.state;
      const assignee = await issue.assignee;
      const issueLabels = await issue.labels();
      const stateName = state?.name || 'Unknown';
      const stateType = state?.type || 'unknown';

      if (!issuesByStateMap.has(stateName)) {
        issuesByStateMap.set(stateName, {
          state: stateName,
          type: stateType,
          count: 0,
          issues: [],
        });
      }

      const group = issuesByStateMap.get(stateName)!;
      group.count++;
      group.issues.push({
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        assignee: assignee?.name || null,
        estimate: issue.estimate ?? null,
        dueDate: issue.dueDate || null,
        url: issue.url,
        labels: issueLabels.nodes.map((l) => l.name),
        createdAt: issue.createdAt.toISOString(),
        updatedAt: issue.updatedAt.toISOString(),
      });

      // Detect blockers: in-progress issues with no update in 3+ days
      if (stateType === 'started') {
        const daysSince = Math.floor((now - issue.updatedAt.getTime()) / 86400000);
        if (daysSince >= 3) {
          blockers.push({
            identifier: issue.identifier,
            title: issue.title,
            assignee: assignee?.name || null,
            daysSinceUpdate: daysSince,
            url: issue.url,
          });
        }
      }
    }

    // Sort issues within each state by priority
    for (const group of issuesByStateMap.values()) {
      group.issues.sort((a, b) => a.priority - b.priority);
    }

    // Process active and upcoming cycles
    let activeCycle: LinearProjectStatus['activeCycle'] = null;
    let upcomingCycle: LinearProjectStatus['upcomingCycle'] = null;

    for (const cycle of cycles.nodes) {
      const startDate = new Date(cycle.startsAt);
      const endDate = new Date(cycle.endsAt);
      const isActive = startDate <= new Date() && endDate >= new Date();
      const isUpcoming = startDate > new Date();

      if (isActive && !activeCycle) {
        const cycleIssues = await cycle.issues();
        let scopeCompleted = 0;
        let scopeTotal = 0;
        let issuesCompleted = 0;
        let issuesInProgress = 0;

        for (const ci of cycleIssues.nodes) {
          const ciState = await ci.state;
          const estimate = ci.estimate ?? 1;
          scopeTotal += estimate;

          if (ciState?.type === 'completed') {
            scopeCompleted += estimate;
            issuesCompleted++;
          } else if (ciState?.type === 'started') {
            issuesInProgress++;
          }
        }

        activeCycle = {
          name: cycle.name || `Ciclo ${cycle.number}`,
          number: cycle.number,
          startsAt: cycle.startsAt.toISOString(),
          endsAt: cycle.endsAt.toISOString(),
          progress: cycle.progress ?? (scopeTotal > 0 ? scopeCompleted / scopeTotal : 0),
          scopeTotal,
          scopeCompleted,
          issuesTotal: cycleIssues.nodes.length,
          issuesCompleted,
          issuesInProgress,
          completedScopeHistory: cycle.completedScopeHistory || [],
          scopeHistory: cycle.scopeHistory || [],
        };
      } else if (isUpcoming && !upcomingCycle) {
        upcomingCycle = {
          name: cycle.name || `Ciclo ${cycle.number}`,
          number: cycle.number,
          startsAt: cycle.startsAt.toISOString(),
          endsAt: cycle.endsAt.toISOString(),
        };
      }
    }

    // Process projects with milestones
    const processedProjects: LinearProjectStatus['projects'] = [];
    for (const proj of teamProjects.nodes) {
      const lead = await proj.lead;
      const milestones = await proj.projectMilestones();

      processedProjects.push({
        name: proj.name,
        state: proj.state,
        progress: proj.progress ?? 0,
        url: proj.url,
        lead: lead?.name || null,
        targetDate: proj.targetDate || null,
        milestones: milestones.nodes.map((m) => ({
          name: m.name,
          targetDate: m.targetDate || null,
          sortOrder: m.sortOrder,
        })).sort((a, b) => a.sortOrder - b.sortOrder),
      });
    }

    // Process labels with issue counts
    const processedLabels: LinearProjectStatus['labels'] = [];
    for (const label of labels.nodes) {
      const labelIssues = await label.issues();
      processedLabels.push({
        name: label.name,
        color: label.color,
        issueCount: labelIssues.nodes.length,
      });
    }
    processedLabels.sort((a, b) => b.issueCount - a.issueCount);

    // Process members
    const processedMembers = members.nodes.map((m) => ({
      name: m.name,
      displayName: m.displayName,
      email: m.email || null,
      active: m.active,
    }));

    // Calculate velocity from completed cycles
    const completedCycles = cycles.nodes.filter((c) => {
      const end = new Date(c.endsAt);
      return end < new Date();
    });

    let avgPointsPerCycle = 0;
    if (completedCycles.length > 0) {
      // Use scope history from completed cycles
      let totalCompleted = 0;
      for (const cycle of completedCycles.slice(0, 3)) {
        const history = cycle.completedScopeHistory || [];
        const lastValue = history.length > 0 ? history[history.length - 1] : 0;
        totalCompleted += lastValue;
      }
      avgPointsPerCycle = Math.round(totalCompleted / Math.min(completedCycles.length, 3));
    }

    // Calculate this week vs last week completion
    const oneWeekAgo = new Date(now - 7 * 86400000);
    const twoWeeksAgo = new Date(now - 14 * 86400000);

    let completedThisWeek = 0;
    let completedLastWeek = 0;
    for (const issue of issues.nodes) {
      const state = await issue.state;
      if (state?.type !== 'completed') continue;
      const completedAt = issue.completedAt;
      if (!completedAt) continue;
      if (completedAt >= oneWeekAgo) completedThisWeek++;
      else if (completedAt >= twoWeeksAgo) completedLastWeek++;
    }

    return {
      team: {
        name: team.name,
        key: teamKey,
        memberCount: processedMembers.length,
      },
      members: processedMembers,
      issuesByState: Array.from(issuesByStateMap.values()).sort((a, b) => {
        const order: Record<string, number> = {
          started: 0,
          unstarted: 1,
          backlog: 2,
          completed: 3,
          canceled: 4,
        };
        return (order[a.type] ?? 5) - (order[b.type] ?? 5);
      }),
      activeCycle,
      upcomingCycle,
      projects: processedProjects,
      labels: processedLabels,
      velocity: {
        completedLastWeek,
        completedThisWeek,
        avgPointsPerCycle,
      },
      blockers,
    };
  } catch (error) {
    logger.error('Failed to fetch Linear project status:', error);
    return null;
  }
}
