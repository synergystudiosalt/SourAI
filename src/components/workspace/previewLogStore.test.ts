import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_LOG_MESSAGE } from '../../security/previewIsolation';
import {
  collectPreviewMessage,
  getPreviewLogs,
  resetPreviewLogs,
  subscribeToPreviewLogs,
} from './previewLogStore';

describe('previewLogStore', () => {
  beforeEach(() => resetPreviewLogs());

  it('rejects a valid-looking message from a different window', () => {
    const previewWindow = {} as Window;
    const otherWindow = {} as Window;
    const data = { type: PREVIEW_LOG_MESSAGE, level: 'error', text: 'boom' };

    expect(collectPreviewMessage({ data, source: otherWindow }, previewWindow)).toBeNull();
    expect(getPreviewLogs()).toEqual([]);
    expect(collectPreviewMessage({ data, source: previewWindow }, previewWindow)).toEqual({
      level: 'error',
      text: 'boom',
    });
  });

  it('clears entries and notifies subscribers when the preview source resets', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPreviewLogs(listener);
    const previewWindow = {} as Window;
    collectPreviewMessage(
      {
        source: previewWindow,
        data: { type: PREVIEW_LOG_MESSAGE, level: 'warn', text: 'old source' },
      },
      previewWindow
    );

    resetPreviewLogs();

    expect(getPreviewLogs()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
