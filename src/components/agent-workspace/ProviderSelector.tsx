import { useId, useState } from 'react';
import { AlertTriangle, Globe, KeyRound, Laptop } from 'lucide-react';

import {
  PROVIDER_CATALOG,
  type CustomEndpointConsent,
  type ProviderCatalogEntry,
} from '../../agent/providers/catalog';

export interface ProviderSelection {
  readonly providerId: string;
  readonly modelId: string;
  readonly consent?: CustomEndpointConsent;
}

interface ProviderSelectorProps {
  readonly selection: ProviderSelection | null;
  readonly hasCredential: boolean;
  readonly onSelect: (selection: ProviderSelection) => void;
  readonly onCredentialChange: (credential: string | undefined) => void;
  readonly disabled?: boolean;
}

export function isSelectable(entry: ProviderCatalogEntry): boolean {
  return entry.kind === 'custom' || entry.browserSupport.state === 'supported';
}

/**
 * Provider and model choice, plus the two things a remote provider needs before
 * it may run: the destination host shown to the user, and a credential that
 * only ever lives in this component's memory.
 */
export function ProviderSelector({
  selection,
  hasCredential,
  onSelect,
  onCredentialChange,
  disabled,
}: ProviderSelectorProps) {
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const credentialId = useId();
  const entry = PROVIDER_CATALOG.find((item) => item.id === selection?.providerId);
  const needsCredential = entry?.requiresCredential === true;

  const approveCustom = () => {
    let url: URL;
    try {
      url = new URL(customEndpoint.trim());
    } catch {
      setCustomError('Enter a full https:// endpoint URL.');
      return;
    }
    if (url.protocol !== 'https:') {
      setCustomError('Custom endpoints must use https.');
      return;
    }
    if (!customModel.trim()) {
      setCustomError('Enter the model id this endpoint expects.');
      return;
    }
    setCustomError(null);
    onSelect({
      providerId: 'openai-compatible',
      modelId: customModel.trim(),
      consent: {
        endpoint: url.toString(),
        host: url.host,
        modelId: customModel.trim(),
        grantedAt: Date.now(),
      },
    });
  };

  return (
    <section aria-label="Provider settings" className="space-y-2 text-[11px]">
      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-60">
          Provider
        </span>
        <select
          aria-label="Model provider"
          disabled={disabled}
          value={selection?.providerId ?? ''}
          onChange={(event) => {
            const next = PROVIDER_CATALOG.find((item) => item.id === event.target.value);
            if (!next) return;
            if (next.kind === 'custom') {
              onSelect({ providerId: next.id, modelId: '' });
              return;
            }
            onSelect({ providerId: next.id, modelId: next.models[0]?.id ?? '' });
          }}
          className="w-full rounded border border-current/15 bg-transparent px-2 py-1"
        >
          <option value="" disabled>
            Choose a provider
          </option>
          {PROVIDER_CATALOG.map((item) => (
            <option key={item.id} value={item.id} disabled={!isSelectable(item)}>
              {item.label}
              {isSelectable(item) ? '' : ' — unavailable'}
            </option>
          ))}
        </select>
      </label>

      {entry && entry.models.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-60">
            Model
          </span>
          <select
            aria-label="Model"
            disabled={disabled}
            value={selection?.modelId ?? ''}
            onChange={(event) =>
              onSelect({
                providerId: entry.id,
                modelId: event.target.value,
                ...(selection?.consent ? { consent: selection.consent } : {}),
              })
            }
            className="w-full rounded border border-current/15 bg-transparent px-2 py-1"
          >
            {entry.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {entry?.kind === 'custom' && (
        <div className="space-y-1.5 rounded border border-dashed border-current/20 p-2">
          <p className="flex items-start gap-1 opacity-75">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              Your prompt and the files listed below will be sent to the host you enter here. Approve
              it only if you trust that host with this project.
            </span>
          </p>
          <input
            aria-label="Custom endpoint URL"
            placeholder="https://host/v1/chat/completions"
            value={customEndpoint}
            onChange={(event) => setCustomEndpoint(event.target.value)}
            className="w-full rounded border border-current/15 bg-transparent px-2 py-1"
          />
          <input
            aria-label="Custom model id"
            placeholder="model id"
            value={customModel}
            onChange={(event) => setCustomModel(event.target.value)}
            className="w-full rounded border border-current/15 bg-transparent px-2 py-1"
          />
          {customError && <p className="text-red-500">{customError}</p>}
          {selection?.consent && (
            <p className="opacity-70">Approved destination: {selection.consent.host}</p>
          )}
          <button
            type="button"
            onClick={approveCustom}
            disabled={disabled}
            className="rounded bg-[#d96b43] px-2 py-1 text-white disabled:opacity-40"
          >
            Approve this destination
          </button>
        </div>
      )}

      {entry?.notice && (
        <p className="flex items-start gap-1 opacity-70">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{entry.notice}</span>
        </p>
      )}

      {entry && (
        <p className="flex items-center gap-1 opacity-70">
          {entry.kind === 'byok' || entry.kind === 'custom' ? (
            <>
              <Globe size={12} />
              <span>Sends data to {selection?.consent?.host ?? entry.host ?? 'the endpoint you approve'}</span>
            </>
          ) : (
            <>
              <Laptop size={12} />
              <span>Runs in this browser; nothing leaves the device</span>
            </>
          )}
        </p>
      )}

      {needsCredential && (
        <label className="block" htmlFor={credentialId}>
          <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-60">
            <KeyRound size={11} /> API key (this tab only)
          </span>
          <input
            id={credentialId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={hasCredential ? 'Key set for this session' : 'Paste key'}
            onChange={(event) => onCredentialChange(event.target.value.trim() || undefined)}
            className="w-full rounded border border-current/15 bg-transparent px-2 py-1"
          />
          <span className="mt-1 block opacity-60">
            Held in memory only. It is never written to storage, events, or exports, and is cleared
            when this tab closes.
          </span>
        </label>
      )}
    </section>
  );
}
