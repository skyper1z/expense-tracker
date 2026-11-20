import { Check, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { CUSTOM_COLORS, CUSTOM_ICONS } from '../lib/categories';
import { newId } from '../lib/ids';
import { CATEGORY_ICONS } from '../components/icons';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '../components/Sheet';
import { Button, cx, describedBy, Field, IconButton, TextInput } from '../components/ui';
import { useData } from '../state/data';
import { useUi } from '../state/ui';

export function CategorySheet({ id, closing }: { id?: string; closing: boolean }) {
  const { data, saveCategory, deleteCategory } = useData();
  const { requestCloseSheet, closeSheet, toast, confirm } = useUi();
  const uid = useId();
  const existing = id ? data.categories.find((c) => c.id === id) : undefined;
  const used = new Set(data.categories.map((c) => c.color));
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'sparkles');
  const [color, setColor] = useState(existing?.color ?? CUSTOM_COLORS.find((c) => !used.has(c)) ?? CUSTOM_COLORS[0]);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  let error = '';
  if (!name.trim()) error = 'Give the category a name.';
  else if (name.length > 40) error = 'Keep the name under 40 characters.';
  else if (data.categories.some((c) => c.id !== id && c.name.trim().toLowerCase() === name.trim().toLowerCase())) {
    error = 'A category with this name already exists.';
  }
  const shownError = attempted ? error : '';
  const count = existing ? data.transactions.filter((t) => t.categoryId === existing.id).length : 0;

  const save = async () => {
    if (saving) return;
    setAttempted(true);
    if (error) {
      document.getElementById(`${uid}-name`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await saveCategory({
        id: existing?.id ?? newId('cat'),
        name: name.trim(),
        icon,
        color,
        builtIn: existing?.builtIn ?? false,
        order: existing?.order ?? 50 + data.categories.length,
      });
      toast(existing ? 'Category updated.' : 'Category added.');
      closeSheet();
    } catch {
      toast('Couldn’t save the category.', { tone: 'error' });
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing || existing.builtIn) return;
    const ok = await confirm({
      title: `Delete “${existing.name}”?`,
      body: count
        ? `${count} ${count === 1 ? 'expense' : 'expenses'} will move to Other. Their amounts and notes stay the same.`
        : 'No expenses use this category.',
      confirmLabel: 'Delete category',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteCategory(existing.id);
    toast('Category deleted.');
    closeSheet();
  };

  const titleId = `${uid}-title`;
  const icons = [...new Set([...CUSTOM_ICONS, 'basket', 'bus', 'zap', 'bag', 'ticket', 'heart', 'shapes', 'percent'])];
  return (
    <Sheet labelledBy={titleId} onClose={requestCloseSheet} closing={closing}>
      <SheetHeader id={titleId} title={existing ? 'Edit category' : 'New category'} onClose={requestCloseSheet} />
      <SheetBody>
        <form
          noValidate
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Name" htmlFor={`${uid}-name`} error={shownError}>
            <TextInput
              id={`${uid}-name`}
              data-autofocus
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Church, School fees, Family support"
              invalid={!!shownError}
              aria-describedby={describedBy(`${uid}-name`, shownError)}
            />
          </Field>
          <fieldset>
            <legend className="mb-2.5 text-[15px] font-medium text-white">Icon</legend>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">
              {icons.map((key) => {
                const Icon = CATEGORY_ICONS[key];
                if (!Icon) return null;
                const sel = icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={sel}
                    aria-label={key}
                    onClick={() => setIcon(key)}
                    className={cx(
                      'inline-flex aspect-square items-center justify-center rounded-2xl border transition-colors',
                      sel ? 'border-white bg-white text-black' : 'border-white/[0.08] bg-white/[0.04] text-white/85 hover:bg-white/[0.08]',
                    )}
                  >
                    <Icon size={20} strokeWidth={1.6} aria-hidden />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2.5 text-[15px] font-medium text-white">Colour</legend>
            <div className="flex flex-wrap gap-2.5">
              {[...CUSTOM_COLORS, '#F5A524', '#38BDF8', '#818CF8', '#F472B6', '#2DD4BF', '#F87171'].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color === c}
                  aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                  className={cx(
                    'inline-flex h-11 w-11 items-center justify-center rounded-full ring-offset-2 ring-offset-ink-900',
                    color === c && 'ring-2 ring-white',
                  )}
                  style={{ background: c }}
                >
                  {color === c && <Check size={18} strokeWidth={2.4} color="#121212" aria-hidden />}
                </button>
              ))}
            </div>
          </fieldset>
          {existing && count > 0 && (
            <p className="text-[13px] text-white/60">
              Used by {count} {count === 1 ? 'expense' : 'expenses'}.
            </p>
          )}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          {existing && !existing.builtIn && (
            <IconButton icon={Trash2} label="Delete category" size={48} onClick={remove} className="text-danger-300" />
          )}
          <Button variant="primary" className="flex-1" onClick={save} disabled={saving}>
            {existing ? 'Save changes' : 'Add category'}
          </Button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
