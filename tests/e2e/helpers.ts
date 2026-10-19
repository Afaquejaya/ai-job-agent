import type { APIRequestContext } from '@playwright/test';
import type { ResumeDetail, TaskDetail, TaskSummary } from '@job-agent/shared';

/** Polls a background task (run by the worker under test) until it is no longer active. */
export async function waitForTask(
  request: APIRequestContext,
  taskId: string,
  timeoutMs = 60_000,
): Promise<TaskDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request.get(`/api/tasks/${taskId}`);
    const { task } = (await response.json()) as { task: TaskDetail };
    if (!task.active) return task;
    if (Date.now() > deadline)
      throw new Error(`Task ${taskId} still ${task.state} after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** After an upload: waits for the background text extraction and returns the processed CV. */
export async function waitForCv(
  request: APIRequestContext,
  upload: { resume: ResumeDetail; task: TaskSummary },
): Promise<ResumeDetail> {
  await waitForTask(request, upload.task.id);
  const response = await request.get(`/api/resumes/${upload.resume.id}`);
  return ((await response.json()) as { resume: ResumeDetail }).resume;
}
