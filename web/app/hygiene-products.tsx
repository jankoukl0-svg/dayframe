"use client";

import { useEffect, useMemo, useState } from "react";
import type { HygieneProduct, HygieneStore } from "@/lib/dayframe-hygiene";
import {
  loadProductPhoto,
  removeProductPhoto,
  saveProductPhoto,
  validateProductPhoto,
} from "@/lib/dayframe-product-photos";

const CATEGORIES = ["Pleť", "Tělo", "Vlasy", "Zuby", "Holení", "Pomůcky", "Ostatní"];
const keyFor = (routineId: string, taskId: string) => routineId + "::" + taskId;

function blankProduct(): HygieneProduct {
  return {
    id: "hygiene-product-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
    name: "", brand: "", category: "Pleť", description: "", instructions: "",
    frequency: "", openedOn: "", expiresOn: "", paoMonths: null, amount: "",
    stockStatus: "ok", shopUrl: "", archived: false,
  };
}

function validShopUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function ProductPhoto({ photoKey, name, large = false }: { photoKey?: string; name: string; large?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setUrl(null);
    if (photoKey) {
      loadProductPhoto(photoKey).then((blob) => {
        if (!live || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => {});
    }
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoKey]);
  return (
    <span className={"df2-product-photo " + (large ? "is-large" : "")}>
      {url ? <img src={url} alt={"Fotografie: " + name} loading="lazy" /> : <span aria-label="Bez fotografie">✦</span>}
    </span>
  );
}

export function HygieneProducts({
  store,
  onSave,
  focusProductId,
  onFocusHandled,
}: {
  store: HygieneStore;
  onSave: (next: HygieneStore) => boolean;
  focusProductId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [filter, setFilter] = useState<"active" | "low" | "archived">("active");
  const [search, setSearch] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HygieneProduct | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [replacementId, setReplacementId] = useState("");

  useEffect(() => {
    if (focusProductId) {
      setViewingId(focusProductId);
      onFocusHandled?.();
    }
  }, [focusProductId, onFocusHandled]);

  useEffect(() => {
    if (!file) {
      setUploadPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setUploadPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const visibleProducts = useMemo(() => store.products
    .filter((product) => filter === "archived" ? product.archived
      : filter === "low" ? !product.archived && product.stockStatus === "low" : !product.archived)
    .filter((product) => [product.name, product.brand, product.category].join(" ").toLocaleLowerCase("cs")
      .includes(search.toLocaleLowerCase("cs")))
    .sort((a, b) => a.name.localeCompare(b.name, "cs")), [store.products, filter, search]);

  const current = store.products.find((product) => product.id === viewingId);
  const linkLabels = (id: string) => store.routines.flatMap((routine) =>
    routine.tasks.filter((task) => (task.productIds ?? []).includes(id))
      .map((task) => routine.title + " · " + task.title));

  const openEditor = (product: HygieneProduct) => {
    setDraft({ ...product });
    setLinks(store.routines.flatMap((routine) =>
      routine.tasks.filter((task) => (task.productIds ?? []).includes(product.id))
        .map((task) => keyFor(routine.id, task.id))));
    setEditError("");
    setFile(null);
    setViewingId(null);
  };

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.name.trim()) {
      setEditError("Vyplň název produktu.");
      return;
    }
    if (!validShopUrl(draft.shopUrl)) {
      setEditError("Odkaz na obchod musí začínat https:// nebo http://.");
      return;
    }
    setSaving(true);
    setEditError("");
    let uploadedKey: string | undefined;
    try {
      if (file) {
        const invalid = validateProductPhoto(file);
        if (invalid) throw new Error(invalid);
        uploadedKey = "photo-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
        await saveProductPhoto(uploadedKey, file);
      }
      const nextProduct: HygieneProduct = {
        ...draft,
        name: draft.name.trim().slice(0, 160),
        brand: draft.brand.trim().slice(0, 160),
        category: draft.category.trim().slice(0, 80),
        description: draft.description.trim().slice(0, 3000),
        instructions: draft.instructions.trim().slice(0, 3000),
        frequency: draft.frequency.trim().slice(0, 400),
        amount: draft.amount.trim().slice(0, 100),
        shopUrl: draft.shopUrl.trim(),
        photoKey: uploadedKey ?? draft.photoKey,
      };
      const exists = store.products.some((item) => item.id === draft.id);
      const selected = new Set(nextProduct.archived ? [] : links);
      const routines = store.routines.map((routine) => ({
        ...routine,
        tasks: routine.tasks.map((task) => {
          const previousIds = (task.productIds ?? []).filter((id) => id !== draft.id);
          const wasLinked = (task.productIds ?? []).includes(draft.id);
          const shouldLink = selected.has(keyFor(routine.id, task.id));
          // Preserve the ordering of existing products when editing an assignment.
          return {
            ...task,
            productIds: shouldLink
              ? wasLinked ? task.productIds : [...previousIds, draft.id]
              : previousIds,
          };
        }),
      }));
      const products = exists
        ? store.products.map((item) => item.id === draft.id ? nextProduct : item)
        : [...store.products, nextProduct];
      if (!onSave({ ...store, products, routines })) throw new Error("Nepodařilo se bezpečně uložit produkt.");
      const previousKey = store.products.find((item) => item.id === draft.id)?.photoKey;
      const stillInHistory = Object.values(store.records).some((date) =>
        Object.values(date).some((record) => record.scheduledTasks.some((task) =>
          task.products?.some((product) => product.photoKey === previousKey))));
      if (previousKey && previousKey !== nextProduct.photoKey && !stillInHistory) {
        void removeProductPhoto(previousKey).catch(() => {});
      }
      setDraft(null);
      setFile(null);
    } catch (cause) {
      if (uploadedKey) await removeProductPhoto(uploadedKey).catch(() => {});
      setEditError(cause instanceof Error ? cause.message : "Fotografii nebo produkt nelze uložit.");
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = (product: HygieneProduct) => {
    const archived = !product.archived;
    const routines = archived ? store.routines.map((routine) => ({
      ...routine,
      tasks: routine.tasks.map((task) => ({
        ...task,
        productIds: (task.productIds ?? []).filter((id) => id !== product.id),
      })),
    })) : store.routines;
    if (onSave({
      ...store,
      routines,
      products: store.products.map((item) => item.id === product.id ? { ...item, archived } : item),
    })) setViewingId(null);
  };

  const deleteProduct = async (product: HygieneProduct) => {
    if (!window.confirm("Opravdu odstranit produkt „" + product.name + "“? Historie splnění rutin zůstane zachována.")) return;
    const routines = store.routines.map((routine) => ({
      ...routine,
      tasks: routine.tasks.map((task) => ({
        ...task,
        productIds: (task.productIds ?? []).filter((id) => id !== product.id),
      })),
    }));
    if (!onSave({ ...store, routines, products: store.products.filter((item) => item.id !== product.id) })) return;
    // Removing the original photo is intentional; text-only historical snapshots remain intact.
    if (product.photoKey) await removeProductPhoto(product.photoKey).catch(() => {});
    setViewingId(null);
  };

  const replaceEverywhere = (product: HygieneProduct, newId: string) => {
    const destination = store.products.find((item) => item.id === newId && !item.archived);
    if (!destination || destination.id === product.id) return;
    const routines = store.routines.map((routine) => ({
      ...routine,
      tasks: routine.tasks.map((task) => ({
        ...task,
        productIds: [...new Set((task.productIds ?? []).map((id) => id === product.id ? destination.id : id))],
      })),
    }));
    if (onSave({ ...store, routines })) {
      setReplacementId("");
      setViewingId(null);
    }
  };

  return (
    <div className="df2-products">
      <header className="df2-products-top">
        <div>
          <span>Osobní knihovna</span>
          <h2>Moje produkty</h2>
          <p>Produkty propojené přímo s hygienickými kroky. Údaje a fotografie jsou uložené v tomto prohlížeči.</p>
        </div>
        <button type="button" className="df2-accent-button" onClick={() => openEditor(blankProduct())}>+ Přidat produkt</button>
      </header>
      <div className="df2-products-toolbar">
        <div role="group" aria-label="Filtr produktů">
          <button type="button" aria-pressed={filter === "active"} onClick={() => setFilter("active")}>Aktivní ({store.products.filter((p) => !p.archived).length})</button>
          <button type="button" aria-pressed={filter === "low"} onClick={() => setFilter("low")}>K dokoupení ({store.products.filter((p) => !p.archived && p.stockStatus === "low").length})</button>
          <button type="button" aria-pressed={filter === "archived"} onClick={() => setFilter("archived")}>Archivované</button>
        </div>
        <input aria-label="Hledat produkt" type="search" placeholder="Hledat produkt…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {visibleProducts.length ? (
        <div className="df2-products-grid">
          {visibleProducts.map((product) => (
            <button type="button" className="df2-product-card" key={product.id}
              onClick={() => { setViewingId(product.id); setReplacementId(""); }} data-product-id={product.id}>
              <ProductPhoto photoKey={product.photoKey} name={product.name} large />
              <span className="df2-product-card-copy">
                <small>{product.category}{product.archived ? " · Archivováno" : ""}</small>
                <strong>{product.name}</strong>
                <span>{product.brand || "Bez značky"}</span>
                {product.stockStatus === "low" && !product.archived && <em>Dochází</em>}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="df2-hygiene-empty">
          <strong>{filter === "low" ? "Nic není označeno k dokoupení." : filter === "archived" ? "Zatím žádné archivované produkty." : "Zatím tu nemáš žádný produkt."}</strong>
          <span>{filter === "active" ? "Přidej svůj první přípravek a přiřaď ho k hygienické rutině." : "Můžeš přepnout na aktivní produkty."}</span>
        </div>
      )}

      {current && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingId(null); }}>
          <section role="dialog" aria-modal="true" aria-label={"Detail produktu " + current.name} className="df2-modal df2-product-dialog">
            <header><div><h2>{current.name}</h2><small>{current.brand} · {current.category}</small></div><button type="button" aria-label="Zavřít detail produktu" onClick={() => setViewingId(null)}>×</button></header>
            <div className="df2-product-detail-hero">
              <ProductPhoto photoKey={current.photoKey} name={current.name} large />
              <div>
                {current.description && <p>{current.description}</p>}
                {current.instructions && <p><strong>Návod:</strong> {current.instructions}</p>}
                {current.frequency && <p><strong>Frekvence:</strong> {current.frequency}</p>}
                {current.amount && <p><strong>Množství:</strong> {current.amount}</p>}
                {current.openedOn && <p><strong>Otevřeno:</strong> {current.openedOn}</p>}
                {current.expiresOn && <p><strong>Expirace:</strong> {current.expiresOn}</p>}
                {current.paoMonths && <p><strong>Po otevření:</strong> {current.paoMonths} měsíců</p>}
                {current.stockStatus === "low" && <p><strong>Dochází · K dokoupení</strong></p>}
                {validShopUrl(current.shopUrl) && current.shopUrl && <a href={current.shopUrl} target="_blank" rel="noopener noreferrer">Otevřít produkt v obchodě ↗</a>}
              </div>
            </div>
            <div className="df2-product-usage"><strong>Používám v</strong>
              {linkLabels(current.id).length ? linkLabels(current.id).map((label) => <span key={label}>{label}</span>) : <span>Zatím nikde nepřiřazeno</span>}
            </div>
            {!current.archived && linkLabels(current.id).length > 0 && store.products.some((p) => p.id !== current.id && !p.archived) && (
              <div className="df2-product-replace">
                <label>Nahradit ve všech rutinách
                  <select aria-label="Náhradní produkt" value={replacementId} onChange={(event) => setReplacementId(event.target.value)}>
                    <option value="">Vybrat náhradní produkt</option>
                    {store.products.filter((p) => !p.archived && p.id !== current.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <button type="button" disabled={!replacementId} onClick={() => replaceEverywhere(current, replacementId)}>Nahradit všude</button>
              </div>
            )}
            <div className="df2-modal-actions df2-product-actions">
              <button type="button" className="df2-primary" onClick={() => openEditor(current)}>Upravit</button>
              <button type="button" onClick={() => toggleArchive(current)}>{current.archived ? "Obnovit" : "Archivovat"}</button>
              <button type="button" className="danger" onClick={() => void deleteProduct(current)}>Odstranit</button>
            </div>
          </section>
        </div>
      )}

      {draft && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDraft(null); }}>
          <section role="dialog" aria-modal="true" aria-label="Editor produktu" className="df2-modal df2-product-dialog">
            <header><div><h2>{store.products.some((p) => p.id === draft.id) ? "Upravit produkt" : "Nový produkt"}</h2></div>
              <button type="button" disabled={saving} aria-label="Zavřít editor produktu" onClick={() => setDraft(null)}>×</button>
            </header>
            <div className="df2-product-photo-editor">
              {uploadPreview ? <span className="df2-product-photo is-large"><img src={uploadPreview} alt="Náhled nahrané fotografie" /></span> :
                <ProductPhoto photoKey={draft.photoKey} name={draft.name || "Produkt"} large />}
              <div><label className="df2-product-file-picker">Nahrát / vyměnit fotografii
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Fotografie produktu" onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  const invalid = selected && validateProductPhoto(selected);
                  setEditError(invalid || "");
                  setFile(invalid ? null : selected);
                  event.target.value = "";
                }} />
              </label>
              <small>JPG, PNG nebo WebP · do 6 MB</small>
              {(draft.photoKey || file) && <button type="button" onClick={() => { setFile(null); setDraft({ ...draft, photoKey: undefined }); }}>Odebrat fotografii</button>}</div>
            </div>
            <div className="df2-product-form-grid">
              <label>Název produktu *<input autoFocus maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label>Značka<input maxLength={160} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
              <label>Kategorie<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                {CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Frekvence podle obalu / vlastní<input value={draft.frequency} placeholder="Např. dle návodu, 2× týdně" onChange={(event) => setDraft({ ...draft, frequency: event.target.value })} /></label>
              <label className="is-wide">Popis a účel<textarea rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <label className="is-wide">Návod k použití<textarea rows={3} value={draft.instructions} placeholder="Pouze ověřené pokyny nebo vlastní postup" onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
              <label>Datum otevření<input type="date" value={draft.openedOn} onChange={(event) => setDraft({ ...draft, openedOn: event.target.value })} /></label>
              <label>Expirace (pokud známá)<input type="date" value={draft.expiresOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} /></label>
              <label>Trvanlivost po otevření (měsíce)<input type="number" min={1} max={60} value={draft.paoMonths ?? ""} onChange={(event) => setDraft({ ...draft, paoMonths: event.target.value ? Math.min(60, Math.max(1, Math.round(Number(event.target.value) || 1))) : null })} /></label>
              <label>Množství / zásoba<input value={draft.amount} placeholder="Např. 50 ml" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
              <label className="is-wide">Odkaz do obchodu<input type="url" value={draft.shopUrl} placeholder="https://" onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} /></label>
              <label className="df2-product-check"><input type="checkbox" checked={draft.stockStatus === "low"} onChange={(event) => setDraft({ ...draft, stockStatus: event.target.checked ? "low" : "ok" })} /> Dochází / potřebuji dokoupit</label>
            </div>
            <div className="df2-product-assign">
              <h3>Přiřadit k hygienickým úkolům</h3>
              <p>Jeden produkt lze používat v několika rutinách. Pořadí produktů v kroku nastavíš při úpravě úkolu.</p>
              {store.routines.map((routine) => (
                <fieldset key={routine.id} disabled={draft.archived}>
                  <legend>{routine.title}</legend>
                  <div>{routine.tasks.map((task) => {
                    const key = keyFor(routine.id, task.id);
                    return <label key={key}><input type="checkbox" checked={links.includes(key)} onChange={(event) =>
                      setLinks((current) => event.target.checked ? [...current, key] : current.filter((id) => id !== key))} />{task.title}</label>;
                  })}</div>
                </fieldset>
              ))}
            </div>
            {editError && <p className="df2-hygiene-error" role="alert">{editError}</p>}
            <div className="df2-modal-actions">
              <button type="button" className="df2-primary" disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? "Ukládám…" : "Uložit produkt"}</button>
              <button type="button" disabled={saving} onClick={() => setDraft(null)}>Zrušit</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
