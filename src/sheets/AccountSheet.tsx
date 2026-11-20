import { Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { touchesAccount } from '../lib/calc';
import { newId, nowIso } from '../lib/ids';
import type { Account, PaymentMethod } from '../lib/types';
import { PAYMENT_METHODS } from '../lib/types';
import { MethodIcon } from '../components/icons';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '../components/Sheet';
import { Button, Chip, describedBy, Field, IconButton, TextInput } from '../components/ui';
import { useData } from '../state/data';
import { useUi } from '../state/ui';

/** Accounts are optional labels for where money is paid from or received into. */
export function AccountSheet({ id, closing }: { id?: string; closing: boolean }) {
  const { data, saveAccount, deleteAccount } = useData();
  const { requestCloseSheet, closeSheet, toast, confirm, setCloseGuard } = useUi();
  const uid = useId();
  const existing = id ? data.accounts.find((a) => a.id === id) : undefined;

  const initial = useMemo(
    () => ({ name: existing?.name ?? '', method: existing?.method ?? ('momo' as PaymentMethod) }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [f, setF] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const dirtyRef = useRef(false);
  dirtyRef.current = JSON.stringify(f) !== JSON.stringify(initial);
  useEffect(() => {
    setCloseGuard(async () =>
      !dirtyRef.current ||
      confirm({ title: 'Discard changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }),
    );
    return () => setCloseGuard(null);
  }, [setCloseGuard, confirm]);

  let error = '';
  if (!f.name.trim()) error = 'Give the account a name.';
  else if (f.name.length > 60) error = 'Keep the name under 60 characters.';
  else if (data.accounts.some((a) => a.id !== existing?.id && a.name.trim().toLowerCase() === f.name.trim().toLowerCase())) {
    error = 'You already have an account with this name.';
  }
  const shownError = attempted ? error : '';
  const linked = existing ? data.transactions.filter((t) => touchesAccount(t, existing.id)).length : 0;

  const save = async () => {
    if (saving) return;
    setAttempted(true);
    if (error) {
      document.getElementById(`${uid}-name`)?.focus();
      return;
    }
    setSaving(true);
    const ts = nowIso();
    const account: Account = {
      id: existing?.id ?? newId('acc'),
      name: f.name.trim(),
      method: f.method,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    try {
      await saveAccount(account);
      toast(existing ? 'Account updated.' : `${account.name} added.`);
      closeSheet();
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`, { tone: 'error' });
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete ${existing.name}?`,
      body:
        linked > 0
          ? `${linked} ${linked === 1 ? 'entry is' : 'entries are'} linked to this account. They stay in your records and spending totals, but won’t be linked to any account.`
          : 'No entries are linked to this account.',
      confirmLabel: 'Delete account',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteAccount(existing.id);
      toast('Account deleted.');
      closeSheet();
    } catch (e) {
      toast(`Couldn’t delete: ${(e as Error).message}`, { tone: 'error' });
    }
  };

  const titleId = `${uid}-title`;
  return (
    <Sheet labelledBy={titleId} onClose={requestCloseSheet} closing={closing}>
      <SheetHeader id={titleId} title={existing ? 'Edit account' : 'Add an account or wallet'} onClose={requestCloseSheet} />
      <SheetBody>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-6"
        >
          <p className="text-[14px] leading-relaxed text-white/65">
            Optional. Name the wallets and accounts you pay from, then pick one when you add an expense.
          </p>
          <Field label="Name" htmlFor={`${uid}-name`} error={shownError}>
            <TextInput
              id={`${uid}-name`}
              data-autofocus
              value={f.name}
              maxLength={70}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. MoMo wallet"
              invalid={!!shownError}
              aria-describedby={describedBy(`${uid}-name`, shownError)}
            />
          </Field>
          <fieldset>
            <legend className="mb-2.5 text-[15px] font-medium text-white">Payment type</legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <Chip key={m.id} selected={f.method === m.id} onClick={() => set('method', m.id)} icon={<MethodIcon method={m.id} size={17} />}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </fieldset>
          {existing && linked > 0 && (
            <p className="text-[13px] leading-snug text-white/60">
              {linked} {linked === 1 ? 'entry is' : 'entries are'} linked to this account.
            </p>
          )}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          {existing && <IconButton icon={Trash2} label="Delete account" size={48} onClick={remove} className="text-danger-300" />}
          <Button variant="primary" className="flex-1" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add account'}
          </Button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
