/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

/* eslint-disable no-for-of-loops/no-for-of-loops */

'use strict';

let Scheduler;
let sharedProfilingArray;
// let runWithPriority;
let ImmediatePriority;
let UserBlockingPriority;
let NormalPriority;
let LowPriority;
let IdlePriority;
let scheduleCallback;
let cancelCallback;
// let wrapCallback;
// let getCurrentPriorityLevel;
// let shouldYield;

function priorityLevelToString(priorityLevel) {
  switch (priorityLevel) {
    case ImmediatePriority:
      return 'Immediate';
    case UserBlockingPriority:
      return 'User-blocking';
    case NormalPriority:
      return 'Normal';
    case LowPriority:
      return 'Low';
    case IdlePriority:
      return 'Idle';
    default:
      return null;
  }
}

describe('Scheduler', () => {
  if (!__PROFILE__) {
    // The tests in this suite only apply when profiling is on
    it('profiling APIs are not available', () => {
      Scheduler = require('scheduler');
      expect(Scheduler.unstable_stopLoggingProfilingEvents).toBe(null);
      expect(Scheduler.unstable_sharedProfilingBuffer).toBe(null);
    });
    return;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.mock('scheduler', () => require('scheduler/unstable_mock'));
    Scheduler = require('scheduler');

    sharedProfilingArray = new Int32Array(
      Scheduler.unstable_sharedProfilingBuffer,
    );

    // runWithPriority = Scheduler.unstable_runWithPriority;
    ImmediatePriority = Scheduler.unstable_ImmediatePriority;
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
    NormalPriority = Scheduler.unstable_NormalPriority;
    LowPriority = Scheduler.unstable_LowPriority;
    IdlePriority = Scheduler.unstable_IdlePriority;
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    cancelCallback = Scheduler.unstable_cancelCallback;
    // wrapCallback = Scheduler.unstable_wrapCallback;
    // getCurrentPriorityLevel = Scheduler.unstable_getCurrentPriorityLevel;
    // shouldYield = Scheduler.unstable_shouldYield;
  });

  const PRIORITY = 0;
  const CURRENT_TASK_ID = 1;
  const CURRENT_RUN_ID = 2;
  const QUEUE_SIZE = 3;

  afterEach(() => {
    if (sharedProfilingArray[QUEUE_SIZE] !== 0) {
      throw Error(
        'Test exited, but the shared profiling buffer indicates that a task ' +
          'is still running',
      );
    }
  });

  const TaskStartEvent = 1;
  const TaskCompleteEvent = 2;
  const TaskErrorEvent = 3;
  const TaskCancelEvent = 4;
  const TaskRunEvent = 5;
  const TaskYieldEvent = 6;
  const SchedulerSuspendEvent = 7;
  const SchedulerResumeEvent = 8;

  function stopProfilingAndPrintFlamegraph() {
    const eventLog = new Int32Array(
      Scheduler.unstable_stopLoggingProfilingEvents(),
    );

    const tasks = new Map();
    const mainThreadRuns = [];

    let i = 0;
    processLog: while (i < eventLog.length) {
      const instruction = eventLog[i];
      const time = eventLog[i + 1];
      switch (instruction) {
        case 0: {
          break processLog;
        }
        case TaskStartEvent: {
          const taskId = eventLog[i + 2];
          const priorityLevel = eventLog[i + 3];
          const task = {
            id: taskId,
            priorityLevel,
            label: null,
            start: time,
            end: -1,
            exitStatus: null,
            runs: [],
          };
          tasks.set(taskId, task);
          i += 4;
          break;
        }
        case TaskCompleteEvent: {
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.end = time;
          task.exitStatus = 'completed';
          i += 3;
          break;
        }
        case TaskErrorEvent: {
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.end = time;
          task.exitStatus = 'errored';
          i += 3;
          break;
        }
        case TaskCancelEvent: {
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.end = time;
          task.exitStatus = 'canceled';
          i += 3;
          break;
        }
        case TaskRunEvent:
        case TaskYieldEvent: {
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.runs.push(time);
          i += 4;
          break;
        }
        case SchedulerSuspendEvent:
        case SchedulerResumeEvent: {
          mainThreadRuns.push(time);
          i += 3;
          break;
        }
        default: {
          throw Error('Unknown instruction type: ' + instruction);
        }
      }
    }

    // Now we can render the tasks as a flamegraph.
    const labelColumnWidth = 30;
    const msPerChar = 50;

    let result = '';

    const mainThreadLabelColumn = '!!! Main thread              ';
    let mainThreadTimelineColumn = '';
    let isMainThreadBusy = false;
    for (const time of mainThreadRuns) {
      const index = time / msPerChar;
      mainThreadTimelineColumn += (isMainThreadBusy ? '█' : ' ').repeat(
        index - mainThreadTimelineColumn.length,
      );
      isMainThreadBusy = !isMainThreadBusy;
    }
    result += `${mainThreadLabelColumn}│${mainThreadTimelineColumn}\n`;

    const tasksByPriority = Array.from(tasks.values()).sort(
      (t1, t2) => t1.priorityLevel - t2.priorityLevel,
    );

    for (const task of tasksByPriority) {
      let label = task.label;
      if (label === undefined) {
        label = 'Task';
      }
      let labelColumn = `Task ${task.id} [${priorityLevelToString(
        task.priorityLevel,
      )}]`;
      labelColumn += ' '.repeat(labelColumnWidth - labelColumn.length - 1);

      // Add empty space up until the start mark
      let timelineColumn = ' '.repeat(task.start / msPerChar);

      let isRunning = false;
      for (const time of task.runs) {
        const index = time / msPerChar;
        timelineColumn += (isRunning ? '█' : '░').repeat(
          index - timelineColumn.length,
        );
        isRunning = !isRunning;
      }

      const endIndex = task.end / msPerChar;
      timelineColumn += (isRunning ? '█' : '░').repeat(
        endIndex - timelineColumn.length,
      );

      if (task.exitStatus !== 'completed') {
        timelineColumn += `🡐 ${task.exitStatus}`;
      }

      result += `${labelColumn}│${timelineColumn}\n`;
    }

    return '\n' + result;
  }

  function getProfilingInfo() {
    const queueSize = sharedProfilingArray[QUEUE_SIZE];
    if (queueSize === 0) {
      return 'Empty Queue';
    }
    const priorityLevel = sharedProfilingArray[PRIORITY];
    if (priorityLevel === 0) {
      return 'Suspended, Queue Size: ' + queueSize;
    }
    return (
      `Task: ${sharedProfilingArray[CURRENT_TASK_ID]}, ` +
      `Run: ${sharedProfilingArray[CURRENT_RUN_ID]}, ` +
      `Priority: ${priorityLevelToString(priorityLevel)}, ` +
      `Queue Size: ${sharedProfilingArray[QUEUE_SIZE]}`
    );
  }

  it('creates a basic flamegraph', () => {
    Scheduler.unstable_startLoggingProfilingEvents();

    Scheduler.unstable_advanceTime(100);
    scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.unstable_advanceTime(300);
        Scheduler.unstable_yieldValue(getProfilingInfo());
        scheduleCallback(
          UserBlockingPriority,
          () => {
            Scheduler.unstable_yieldValue(getProfilingInfo());
            Scheduler.unstable_advanceTime(300);
          },
          {label: 'Bar'},
        );
        Scheduler.unstable_advanceTime(100);
        Scheduler.unstable_yieldValue('Yield');
        return () => {
          Scheduler.unstable_yieldValue(getProfilingInfo());
          Scheduler.unstable_advanceTime(300);
        };
      },
      {label: 'Foo'},
    );
    expect(Scheduler).toFlushAndYieldThrough([
      'Task: 1, Run: 1, Priority: Normal, Queue Size: 1',
      'Yield',
    ]);
    Scheduler.unstable_advanceTime(100);
    expect(Scheduler).toFlushAndYield([
      'Task: 2, Run: 2, Priority: User-blocking, Queue Size: 2',
      'Task: 1, Run: 3, Priority: Normal, Queue Size: 1',
    ]);

    expect(getProfilingInfo()).toEqual('Empty Queue');

    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │          ██
Task 2 [User-blocking]       │        ░░░░██████
Task 1 [Normal]              │  ████████░░░░░░░░██████
`,
    );
  });

  it('marks when a task is canceled', () => {
    Scheduler.unstable_startLoggingProfilingEvents();

    const task = scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_yieldValue(getProfilingInfo());
      Scheduler.unstable_advanceTime(300);
      Scheduler.unstable_yieldValue('Yield');
      return () => {
        Scheduler.unstable_yieldValue('Continuation');
        Scheduler.unstable_advanceTime(200);
      };
    });

    expect(Scheduler).toFlushAndYieldThrough([
      'Task: 1, Run: 1, Priority: Normal, Queue Size: 1',
      'Yield',
    ]);
    Scheduler.unstable_advanceTime(100);

    cancelCallback(task);

    // Advance more time. This should not affect the size of the main
    // thread row, since the Scheduler queue is empty.
    Scheduler.unstable_advanceTime(1000);
    expect(Scheduler).toFlushWithoutYielding();

    // The main thread row should end when the callback is cancelled.
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │      ██
Task 1 [Normal]              │██████░░🡐 canceled
`,
    );
  });

  it('marks when a task errors', () => {
    Scheduler.unstable_startLoggingProfilingEvents();

    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(300);
      throw Error('Oops');
    });

    expect(Scheduler).toFlushAndThrow('Oops');
    Scheduler.unstable_advanceTime(100);

    // Advance more time. This should not affect the size of the main
    // thread row, since the Scheduler queue is empty.
    Scheduler.unstable_advanceTime(1000);
    expect(Scheduler).toFlushWithoutYielding();

    // The main thread row should end when the callback is cancelled.
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │
Task 1 [Normal]              │██████🡐 errored
`,
    );
  });

  it('handles cancelling a task that already finished', () => {
    Scheduler.unstable_startLoggingProfilingEvents();

    const task = scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_yieldValue('A');
      Scheduler.unstable_advanceTime(1000);
    });
    expect(Scheduler).toFlushAndYield(['A']);
    cancelCallback(task);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │
Task 1 [Normal]              │████████████████████
`,
    );
  });

  it('handles cancelling a task multiple times', () => {
    Scheduler.unstable_startLoggingProfilingEvents();

    scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.unstable_yieldValue('A');
        Scheduler.unstable_advanceTime(1000);
      },
      {label: 'A'},
    );
    Scheduler.unstable_advanceTime(200);
    const task = scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.unstable_yieldValue('B');
        Scheduler.unstable_advanceTime(1000);
      },
      {label: 'B'},
    );
    Scheduler.unstable_advanceTime(400);
    cancelCallback(task);
    cancelCallback(task);
    cancelCallback(task);
    expect(Scheduler).toFlushAndYield(['A']);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │████████████
Task 1 [Normal]              │░░░░░░░░░░░░████████████████████
Task 2 [Normal]              │    ░░░░░░░░🡐 canceled
`,
    );
  });

  it('handles cancelling a delayed task', () => {
    Scheduler.unstable_startLoggingProfilingEvents();
    const task = scheduleCallback(
      NormalPriority,
      () => Scheduler.unstable_yieldValue('A'),
      {delay: 1000},
    );
    cancelCallback(task);
    expect(Scheduler).toFlushWithoutYielding();
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │
`,
    );
  });

  it('resizes event log buffer if there are many events', () => {
    const tasks = [];
    for (let i = 0; i < 5000; i++) {
      tasks.push(scheduleCallback(NormalPriority, () => {}));
    }
    expect(getProfilingInfo()).toEqual('Suspended, Queue Size: 5000');
    tasks.forEach(task => cancelCallback(task));
    expect(getProfilingInfo()).toEqual('Empty Queue');
  });
});
