import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudioOverviewPlayer, formatAudioTime } from './AudioOverviewPlayer';

describe('AudioOverviewPlayer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('formats overview durations', () => {
    expect(formatAudioTime(0)).toBe('0:00');
    expect(formatAudioTime(184.9)).toBe('3:04');
  });

  it('plays with a moving waveform, seeks and mutes', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(this: HTMLMediaElement) {
      fireEvent.play(this);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause(this: HTMLMediaElement) {
      fireEvent.pause(this);
    });

    render(<AudioOverviewPlayer src="blob:audio-overview" />);
    const audio = screen.getByLabelText('Audio overview') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 184 });
    fireEvent.loadedMetadata(audio);

    await user.click(screen.getByRole('button', { name: 'Play audio overview' }));
    expect(screen.getByRole('img', { name: 'Animated audio waveform' })).toHaveAttribute('data-playing', 'true');
    expect(screen.getByText('3:04')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: 'Seek audio overview' }), { target: { value: '61' } });
    expect(screen.getByText('1:01')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mute audio overview' }));
    expect(audio.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute audio overview' })).toBeInTheDocument();
  });
});
