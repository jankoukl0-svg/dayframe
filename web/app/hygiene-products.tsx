"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HygieneProduct, HygieneStore } from "@/lib/dayframe-hygiene";
import { ProductCareGuide } from "./hygiene-care-guide";
import { findBestProductPackshot, type PackshotCandidate } from "@/lib/dayframe-product-packshots";
import { chooseImportedValue, isCatalogBoilerplate } from "@/lib/dayframe-product-quality.mjs";
import { effectiveExpiry, hygieneInventoryAlerts, hygieneShoppingCost, hygieneShoppingList, recordHygienePurchase } from "@/lib/dayframe-hygiene-inventory";
import {
  loadProductPhoto,
  removeProductPhoto,
  saveProductPhoto,
  validateProductPhoto,
} from "@/lib/dayframe-product-photos";

const CATEGORIES = ["Pleť", "Tělo", "Vlasy", "Zuby", "Holení", "Vůně", "Pomůcky", "Ostatní"];
const keyFor = (routineId: string, taskId: string) => routineId + "::" + taskId;

type ProductLookupMatch = {
  name: string;
  brand: string;
  category: string;
  description: string;
  instructions: string;
  usageWhen?: string;
  usageAmount?: string;
  usageDuration?: string;
  precautions?: string;
  frequency?: string;
  guideSourceUrl?: string;
  guideSourceUrls?: string[];
  safetySource?: string;
  amount: string;
  priceCzk: number | null;
  imageUrl: string;
  sourceUrl: string;
  sourceLabel: string;
};
type ProductLookupResponse = { matches?: ProductLookupMatch[]; notice?: string; error?: string };
const LOOKUP_ENDPOINT = "/api/hygiene-product-lookup";
type ProductGuideEnrichment = Partial<ProductLookupMatch> & { description?: string };

function mergeProductGuide(current: HygieneProduct, source: ProductGuideEnrichment, overwrite: boolean) {
  return {
    ...current,
    description: chooseImportedValue(current.description, source.description, overwrite, true).slice(0, 3000),
    instructions: chooseImportedValue(current.instructions, source.instructions, overwrite).slice(0, 3000),
    usageWhen: chooseImportedValue(current.usageWhen, source.usageWhen, overwrite).slice(0, 400),
    usageAmount: chooseImportedValue(current.usageAmount, source.usageAmount, overwrite).slice(0, 400),
    usageDuration: chooseImportedValue(current.usageDuration, source.usageDuration, overwrite).slice(0, 400),
    frequency: chooseImportedValue(current.frequency, source.frequency, overwrite).slice(0, 400),
    precautions: chooseImportedValue(current.precautions, source.precautions, overwrite).slice(0, 2700),
  };
}


function blankProduct(): HygieneProduct {
  return {
    id: "hygiene-product-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
    name: "", brand: "", category: "Pleť", description: "", instructions: "",
    frequency: "", usageWhen: "", usageAmount: "", usageDuration: "", precautions: "",
    openedOn: "", expiresOn: "", paoMonths: null, amount: "",
    stockStatus: "ok", stockCount: null, stockMinimum: null, priceCzk: null,
    replacementEveryDays: null, lastReplacedOn: "", shopUrl: "", archived: false,
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
  today,
}: {
  store: HygieneStore;
  today: string;
  onSave: (next: HygieneStore) => boolean;
  focusProductId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [filter, setFilter] = useState<"active" | "low" | "alerts" | "archived">("active");
  const [purchaseQuantities, setPurchaseQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HygieneProduct | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMatches, setLookupMatches] = useState<ProductLookupMatch[]>([]);
  const [lookupNotice, setLookupNotice] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookupImporting, setLookupImporting] = useState(false);
  const [lookupSource, setLookupSource] = useState("");
  const [overwriteKnown, setOverwriteKnown] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNotice, setPhotoNotice] = useState("");
  const photoPreferenceRef = useRef<"none" | "manual" | "automatic">("none");
  const activeEditorRef = useRef<string | null>(null);
  const photoSessionRef = useRef(0);


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

  const shopping = useMemo(() => hygieneShoppingList(store.products), [store.products]);
  const alerts = useMemo(() => hygieneInventoryAlerts(store.products, today), [store.products, today]);
  const shoppingCost = useMemo(() => hygieneShoppingCost(shopping.map((item) => ({
    ...item, needed: purchaseQuantities[item.product.id] ?? item.needed,
  }))), [shopping, purchaseQuantities]);
  const money = (amount: number) => new Intl.NumberFormat("cs-CZ", {
    style: "currency", currency: "CZK", maximumFractionDigits: 2,
  }).format(amount);

  const updateOne = (id: string, patch: Partial<HygieneProduct>) => onSave({
    ...store, products: store.products.map((product) => product.id === id ? { ...product, ...patch } : product),
  });
  const buy = (id: string, qty: number) => {
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) return;
    const product = store.products.find((item) => item.id === id);
    if (!product) return;
    if (updateOne(id, recordHygienePurchase(product, qty))) {
      setPurchaseQuantities((previous) => {
        const next = { ...previous }; delete next[id]; return next;
      });
    }
  };
  const visibleProducts = useMemo(() => store.products
    .filter((product) => filter === "archived" ? product.archived
      : filter === "low" ? !product.archived && shopping.some((item) => item.product.id === product.id)
      : filter === "alerts" ? !product.archived && alerts.some((item) => item.product.id === product.id)
      : !product.archived)
    .filter((product) => [product.name, product.brand, product.category].join(" ").toLocaleLowerCase("cs")
      .includes(search.toLocaleLowerCase("cs")))
    .sort((a, b) => a.name.localeCompare(b.name, "cs")), [store.products, shopping, alerts, filter, search]);

  const categoryGroups = useMemo(() => {
    const byCategory = new Map<string, HygieneProduct[]>();
    for (const product of visibleProducts) {
      const category = product.category.trim() || "Ostatní";
      const group = byCategory.get(category) ?? [];
      group.push(product);
      byCategory.set(category, group);
    }
    // Main hygiene groups stay in a predictable order. Additional/custom
    // categories are never lost; uncategorized products appear last.
    const categories = [
      ...CATEGORIES.filter((category) => category !== "Ostatní"),
      ...[...byCategory.keys()]
        .filter((category) => !CATEGORIES.includes(category))
        .sort((a, b) => a.localeCompare(b, "cs")),
      "Ostatní",
    ];
    return categories.flatMap((category) => {
      const products = byCategory.get(category);
      return products?.length ? [{ category, products }] : [];
    });
  }, [visibleProducts]);

  const current = store.products.find((product) => product.id === viewingId);
  const linkLabels = (id: string) => store.routines.flatMap((routine) =>
    routine.tasks.filter((task) => (task.productIds ?? []).includes(id))
      .map((task) => routine.title + " · " + task.title));

  const closeEditor = () => {
    // Ignore responses from previous editor sessions, including a reopened product.
    photoSessionRef.current += 1;
    activeEditorRef.current = null;
    setDraft(null);
    setPhotoBusy(false);
  };

  const openEditor = (product: HygieneProduct) => {
    photoSessionRef.current += 1;
    activeEditorRef.current = product.id;
    photoPreferenceRef.current = "none";
    setPhotoBusy(false);
    setPhotoNotice("");
    setDraft({ ...product });
    setLinks(store.routines.flatMap((routine) =>
      routine.tasks.filter((task) => (task.productIds ?? []).includes(product.id))
        .map((task) => keyFor(routine.id, task.id))));
    setEditError("");
    setFile(null);
    setLookupQuery("");
    setLookupMatches([]);
    setLookupError("");
    setLookupNotice("");
    setLookupBusy(false);
    setLookupImporting(false);
    setLookupSource("");
    setOverwriteKnown(false);
    setViewingId(null);
  };

  const searchProduct = async (requested?: string) => {
    const fallbackName = draft?.name ? [draft.brand, draft.name].filter(Boolean).join(" ") : "";
    const query = (requested ?? (lookupQuery.trim() || draft?.shopUrl || fallbackName)).trim();
    if (query.length < 3) {
      setLookupError("Zadej alespoň 3 znaky názvu nebo odkaz na produkt.");
      return;
    }
    setLookupBusy(true);
    setLookupError("");
    setLookupMatches([]);
    setLookupNotice("");
    try {
      const response = await fetch(LOOKUP_ENDPOINT + "?query=" + encodeURIComponent(query), {
        headers: { Accept: "application/json" },
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error("Vyhledávací služba na tomto nasazení není dostupná.");
      const data = await response.json() as ProductLookupResponse;
      if (!response.ok) throw new Error(data.error || "Produkt nelze vyhledat.");
      const found = (data.matches ?? []).filter((item) =>
        item && typeof item.name === "string" && item.name.trim() && typeof item.sourceUrl === "string");
      setLookupMatches(found);
      setLookupNotice(data.notice || (!found.length ? "Nenašel se ověřitelný produkt. Zkus jiný odkaz." : ""));
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Vyhledávání není dostupné.");
    } finally {
      setLookupBusy(false);
    }
  };


  const findProductPhoto = async (name: string, brand: string, sourceUrl: string,
    preferredImage = "", replaceExisting = false, photoOfId?: string, expectedSession?: number) => {
    const id = photoOfId ?? draft?.id;
    const session = photoSessionRef.current;
    if (expectedSession !== undefined && session !== expectedSession) return;
    if (!id || photoBusy || (!replaceExisting && (photoPreferenceRef.current === "manual"
      || Boolean(file) || Boolean(draft?.photoKey)))) return;
    setPhotoBusy(true);
    setPhotoNotice("Hledám čistou produktovou fotografii s bílým pozadím…");
    try {
      const params = new URLSearchParams({
        mode: "photos", name, brand, url: sourceUrl.startsWith("https://") ? sourceUrl : "",
        image: preferredImage,
      });
      let candidates: PackshotCandidate[] = [];
      try {
        const response = await fetch(LOOKUP_ENDPOINT + "?" + params, {
          signal: AbortSignal.timeout(17000),
        });
        if (response.ok) {
          const payload = await response.json() as { candidates?: PackshotCandidate[] };
          candidates = (payload.candidates ?? []).filter((item) =>
            item && typeof item.url === "string" && typeof item.source === "string"
            && typeof item.priority === "number");
        }
      } catch { /* can still import the chosen product's own image */ }
      if (preferredImage && !candidates.some((item) => item.url === preferredImage))
        candidates.unshift({ url: preferredImage, source: "Vybraný produkt", priority: 20 });
      const selected = await findBestProductPackshot(candidates);
      if (activeEditorRef.current !== id || photoSessionRef.current !== session) return;
      // A manual selection always wins even if this lookup was explicitly requested.
      if (photoPreferenceRef.current === "manual") return;
      if (!selected) {
        setPhotoNotice("Ověřitelnou fotografii tohoto produktu se nepodařilo stáhnout. Můžeš ji nahrát ručně.");
        return;
      }
      const invalid = validateProductPhoto(selected.file);
      if (invalid) { setPhotoNotice(invalid); return; }
      photoPreferenceRef.current = "automatic";
      setFile(selected.file);
      setPhotoNotice(selected.quality === "white"
        ? "Vybral jsem fotografii s bílým nebo průhledným pozadím · " + selected.source
        : selected.quality === "cleaned"
          ? "Pozadí fotografie jsem sjednotil na bílou · " + selected.source
          : "Vybral jsem nejčistší dostupnou fotografii · " + selected.source
            + ". Bílé pozadí nelze spolehlivě zaručit.");
    } catch {
      if (activeEditorRef.current === id && photoSessionRef.current === session)
        setPhotoNotice("Fotografie se nepodařila zpracovat. Můžeš vybrat vlastní.");
    } finally {
      if (activeEditorRef.current === id && photoSessionRef.current === session) setPhotoBusy(false);
    }
  };

  const applyLookupMatch = async (match: ProductLookupMatch) => {
    if (!draft || lookupImporting) return;
    const draftId = draft.id;
    const initiatedSession = photoSessionRef.current;
    const isCurrentSession = () => activeEditorRef.current === draftId && photoSessionRef.current === initiatedSession;
    const isNew = !store.products.some((item) => item.id === draftId);
    const enteredLink = /^https:\/\//i.test(lookupQuery.trim()) ? lookupQuery.trim() : "";
    setDraft((current) => current && current.id === draftId ? mergeProductGuide({
      ...current,
      name: isNew || !current.name.trim() ? match.name.slice(0, 160) : current.name,
      brand: current.brand.trim() || (match.brand || "").slice(0, 160),
      category: isNew && match.category ? match.category : current.category,
      description: current.description,
      amount: current.amount.trim() || (match.amount || "").slice(0, 100),
      priceCzk: current.priceCzk ?? match.priceCzk ?? null,
      shopUrl: enteredLink || current.shopUrl,
    }, match, overwriteKnown) : current);
    const guideSources = Array.isArray(match.guideSourceUrls) ? match.guideSourceUrls.filter(Boolean) : [];
    setLookupSource(guideSources.length ? "Pokyny výrobce: " + guideSources.join(" · ")
      + " | Katalogový záznam: " + match.sourceUrl
      : (match.guideSourceUrl ? "Pokyny: " + match.guideSourceUrl + " | Produkt: " + match.sourceUrl
        : match.sourceLabel + " · " + match.sourceUrl));
    setLookupMatches([]);
    setLookupNotice(match.instructions && match.description
      ? "Popis a dostupné pokyny výrobce jsou předvyplněné. Ověř je podle obalu před uložením."
      : "Základní údaje jsou předvyplněné. Prohledávám stránky výrobce a prodejců kvůli návodu a upozorněním…");
    setLookupError("");

    setLookupImporting(true);
    let gotDetailedGuide = Boolean(match.instructions || match.precautions || match.usageWhen || match.usageAmount || match.usageDuration);
    try {
      // Name-only matches are often sparse catalog records, so look for a maker's instructions.
      if ((!match.instructions || !match.precautions || !match.usageWhen || !match.description) && match.name) {
        try {
          const args = new URLSearchParams({
            mode: "guide", name: match.name, brand: match.brand, url: match.sourceUrl,
          });
          const response = await fetch(LOOKUP_ENDPOINT + "?" + args, {
            signal: AbortSignal.timeout(24000),
          });
          if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
            const result = await response.json() as {
              guide?: Partial<ProductLookupMatch>; description?: string;
              sourceUrl?: string; sourceUrls?: string[]; warning?: string; safetySource?: string;
            };
            if (!isCurrentSession()) return;
            if (result.guide) {
              gotDetailedGuide = gotDetailedGuide || Boolean(result.guide.instructions || result.guide.precautions
                || result.guide.usageWhen || result.guide.usageAmount || result.guide.usageDuration);
              setDraft((current) => current && current.id === draftId
                ? mergeProductGuide(current, {
                  ...result.guide, description: result.description,
                }, overwriteKnown) : current);
              if (result.warning) setLookupError(result.warning);
              if (result.sourceUrls?.length) setLookupSource("Zdroje pokynů: "
                + result.sourceUrls.join(" · ") + " | Produkt: " + match.sourceUrl);
              else if (result.sourceUrl) setLookupSource("Návod: " + result.sourceUrl + " · produkt: " + match.sourceUrl);
            }
          }
        } catch { /* product may be unavailable on manufacturer sites; keep known fields */ }
      }
      if (!isCurrentSession()) return;
      if (!file && !draft.photoKey && photoPreferenceRef.current !== "manual") {
        await findProductPhoto(match.name, match.brand, match.sourceUrl, match.imageUrl,
          false, draftId, initiatedSession);
      }
      if (!isCurrentSession()) return;
      setLookupNotice(!gotDetailedGuide
        ? "Základní údaje jsou doplněné, ale ověřitelné pokyny k použití se nepodařilo najít. Zkus odkaz výrobce nebo je doplň z obalu."
        : "Dostupné pokyny výrobce nebo prodejce byly doplněné. Zkontroluj je podle obalu; chybějící informace nevymýšlíme.");
    } finally {
      if (isCurrentSession()) setLookupImporting(false);
    }
  };

  const researchCurrentProduct = async () => {
    if (!draft || draft.name.trim().length < 3 || lookupImporting) return;
    const draftId = draft.id;
    setLookupError("");
    setLookupNotice("Dohledávám návod a rizika u konkrétního produktu…");
    setLookupImporting(true);
    try {
      const params = new URLSearchParams({
        mode: "guide", name: draft.name, brand: draft.brand,
        url: draft.shopUrl.startsWith("https://") ? draft.shopUrl : "",
      });
      const response = await fetch(LOOKUP_ENDPOINT + "?" + params.toString(), {
        signal: AbortSignal.timeout(24000),
      });
      if (!response.ok) throw new Error("Podrobnosti se nepodařilo načíst.");
      const data = await response.json() as {
        guide?: ProductGuideEnrichment; description?: string; sourceUrl?: string;
        sourceUrls?: string[]; warning?: string; safetySource?: string;
      };
      const enriched: ProductGuideEnrichment = { ...data.guide, description: data.description };
      const count = ["instructions", "usageWhen", "usageAmount", "usageDuration", "frequency", "precautions", "description"]
        .filter((key) => Boolean(enriched[key as keyof ProductGuideEnrichment])).length;
      if (count) setDraft((previous) => previous?.id === draftId
        ? mergeProductGuide(previous, enriched, overwriteKnown) : previous);
      setLookupSource(data.sourceUrls?.length ? "Zdroje: " + data.sourceUrls.join(" · ")
        : data.sourceUrl ? "Zdroj: " + data.sourceUrl : "");
      const missingWarnings = !(data.guide?.precautions || draft.precautions);
      setLookupNotice(count
        ? "Doplněné údaje jsou převzaté z dostupných zdrojů. Před použitím je zkontroluj podle obalu."
        : "Pro tuto konkrétní variantu se nepodařilo ověřit podrobnosti. Zkus přímý odkaz výrobce nebo text z etikety.");
      if (data.warning) setLookupError(data.warning);
      else if (missingWarnings) setLookupError("Upozornění ani rizika nebyla ve zdrojích ověřena. Neznamená to, že produkt nemá rizika.");
    } catch {
      setLookupNotice("Podrobnější zdroje nebyly dostupné. Můžeš vložit odkaz výrobce nebo doplnit údaje z obalu.");
    } finally {
      setLookupImporting(false);
    }
  };

  const save = async () => {
    if (!draft || saving || lookupImporting || photoBusy) return;
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
        usageWhen: (draft.usageWhen ?? "").trim().slice(0, 400),
        usageAmount: (draft.usageAmount ?? "").trim().slice(0, 400),
        usageDuration: (draft.usageDuration ?? "").trim().slice(0, 400),
        precautions: (draft.precautions ?? "").trim().slice(0, 2700),
        amount: draft.amount.trim().slice(0, 100),
        shopUrl: draft.shopUrl.trim(),
        stockCount: draft.stockCount ?? null,
        stockMinimum: draft.stockMinimum ?? null,
        priceCzk: draft.priceCzk ?? null,
        replacementEveryDays: draft.replacementEveryDays ?? null,
        lastReplacedOn: draft.lastReplacedOn ?? "",
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
      closeEditor();
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
          <button type="button" aria-pressed={filter === "low"} onClick={() => setFilter("low")}>Nákupní seznam ({shopping.length})</button>
          <button type="button" aria-pressed={filter === "alerts"} onClick={() => setFilter("alerts")}>Expirace a výměny ({alerts.length})</button>
          <button type="button" aria-pressed={filter === "archived"} onClick={() => setFilter("archived")}>Archivované</button>
        </div>
        <input aria-label="Hledat produkt" type="search" placeholder="Hledat produkt…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {filter === "low" && (
        <div className="df2-inventory-summary">
          <div><span>K dokoupení</span><strong>{shopping.length} produktů</strong></div>
          <div><span>Odhad nákupu</span><strong>{money(shoppingCost.known)}</strong></div>
          <small>{shoppingCost.missing ? shoppingCost.missing + " produktů bez zadané ceny. Součet není konečná částka." : "Odhad podle uložených cen. Aktuální ceny v obchodech nejsou ověřené."}</small>
        </div>
      )}
      {filter === "low" && visibleProducts.length > 0 && (
        <div className="df2-inventory-shopping" aria-label="Nákupní seznam">
          {visibleProducts.map((product) => {
            const item = shopping.find((entry) => entry.product.id === product.id);
            if (!item) return null;
            const quantity = purchaseQuantities[product.id] ?? item.needed;
            return <article key={product.id} data-shopping-product={product.id}>
              <ProductPhoto photoKey={product.photoKey} name={product.name} />
              <div className="df2-inventory-item-copy"><strong>{product.name}</strong>
                <small>{item.source === "manual" ? "Ručně označeno" : item.source === "threshold"
                  ? "Nízká zásoba" : "Nízká zásoba · ručně označeno"}</small>
                {product.stockCount != null && <small>Na skladě: {product.stockCount} ks · hranice: {product.stockMinimum ?? "nenastavena"}</small>}
                {product.priceCzk != null && <span>{money(product.priceCzk)} / ks · odhad {money(product.priceCzk * quantity)}</span>}
              </div>
              <label>Počet kusů k nákupu
                <input type="number" min={1} max={10000} value={quantity}
                  aria-label={"Počet kusů k nákupu " + product.name}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setPurchaseQuantities((previous) => ({
                      ...previous,
                      [product.id]: Math.max(1, Math.min(10000, Math.floor(value) || 1)),
                    }));
                  }} />
              </label>
              <div className="df2-inventory-item-actions">
                {product.shopUrl && validShopUrl(product.shopUrl) && <a href={product.shopUrl} target="_blank"
                  rel="noopener noreferrer">Otevřít obchod ↗</a>}
                <button type="button" onClick={() => buy(product.id, quantity)}>Koupeno</button>
              </div>
            </article>;
          })}
        </div>
      )}
      {filter === "alerts" && alerts.filter((alert) => visibleProducts.some((product) => product.id === alert.product.id)).length > 0 && (
        <div className="df2-inventory-alerts" aria-label="Hlídání expirace a výměn">
          {alerts.filter((alert) => visibleProducts.some((product) => product.id === alert.product.id))
            .map((alert) => <article key={alert.product.id + alert.kind} data-inventory-alert={alert.product.id + "-" + alert.kind}>
              <ProductPhoto photoKey={alert.product.photoKey} name={alert.product.name} />
              <div><strong>{alert.product.name}</strong>
                <small>{alert.detail} · termín {alert.dueOn}</small>
                <span>{alert.daysLeft < 0 ? "Po termínu o " + Math.abs(alert.daysLeft) + " dní"
                  : alert.daysLeft === 0 ? "Termín dnes" : "Zbývá " + alert.daysLeft + " dní"}</span>
              </div>
              <div className="df2-inventory-item-actions">
                <button type="button" onClick={() => updateOne(alert.product.id, { stockStatus: "low" })}>Přidat k nákupu</button>
                {alert.kind === "replacement" && <button type="button"
                  aria-label={"Vyměněno dnes " + alert.product.name}
                  onClick={() => updateOne(alert.product.id, { lastReplacedOn: today })}>Vyměněno dnes</button>}
                <button type="button" onClick={() => openEditor(alert.product)}>Upravit údaje</button>
              </div>
            </article>)}
        </div>
      )}
      {(filter === "active" || filter === "archived") && visibleProducts.length ? (
        <div className="df2-products-categories" aria-label="Produkty podle kategorií">
          {categoryGroups.map(({ category, products }) => (
            <section className="df2-products-category" aria-label={"Kategorie " + category} key={category}>
              <header className="df2-products-category-heading">
                <h3>{category}</h3>
                <span>{products.length} {products.length === 1 ? "produkt" : products.length < 5 ? "produkty" : "produktů"}</span>
              </header>
              <div className="df2-products-grid">
                {products.map((product) => (
                  <button type="button" className="df2-product-card" key={product.id}
                    onClick={() => { setViewingId(product.id); setReplacementId(""); }} data-product-id={product.id}>
                    <ProductPhoto photoKey={product.photoKey} name={product.name} large />
                    <span className="df2-product-card-copy">
                      {product.archived && <small>Archivováno</small>}
                      <strong>{product.name}</strong>
                      <span>{product.brand || "Bez značky"}</span>
                      {!product.archived && shopping.some((entry) => entry.product.id === product.id) && <em>Dokoupit</em>}
                      {product.stockCount != null && <span>Na skladě: {product.stockCount} ks</span>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : filter === "active" || filter === "archived" || !visibleProducts.length ? (
        <div className="df2-hygiene-empty">
          <strong>{filter === "low" ? "Nákupní seznam je prázdný." :
            filter === "alerts" ? "Žádná blížící se expirace ani výměna." :
            filter === "archived" ? "Zatím žádné archivované produkty." : "Zatím tu nemáš žádný produkt."}</strong>
          <span>{filter === "active" ? "Přidej svůj první přípravek a přiřaď ho k hygienické rutině." :
            filter === "low" ? "Přidej produkty do seznamu nebo nastav číselnou rezervu v jejich detailu." :
            filter === "alerts" ? "Expirace se hlídá 30 dní dopředu; výměny několik dní před termínem podle délky cyklu." :
            "Můžeš přepnout na aktivní produkty."}</span>
        </div>
      ) : null}

      {current && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingId(null); }}>
          <section role="dialog" aria-modal="true" aria-label={"Detail produktu " + current.name} className="df2-modal df2-product-dialog">
            <header><div><h2>{current.name}</h2><small>{current.brand} · {current.category}</small></div><button type="button" aria-label="Zavřít detail produktu" onClick={() => setViewingId(null)}>×</button></header>
            <div className="df2-product-detail-hero">
              <ProductPhoto photoKey={current.photoKey} name={current.name} large />
              <div>
                {current.description && <p>{current.description}</p>}
                <ProductCareGuide product={current} />
                {current.amount && <p><strong>Velikost balení:</strong> {current.amount}</p>}
                {current.stockCount != null && <p><strong>Na skladě:</strong> {current.stockCount} ks
                  {current.stockMinimum != null ? " · hranice dokoupení " + current.stockMinimum + " ks" : ""}</p>}
                {current.priceCzk != null && <p><strong>Cena za kus:</strong> {money(current.priceCzk)}</p>}
                {current.replacementEveryDays && <p><strong>Výměna pomůcky:</strong> každých {current.replacementEveryDays} dní
                  {current.lastReplacedOn ? " · naposledy " + current.lastReplacedOn : " · poslední výměna není zadána"}</p>}
                {effectiveExpiry(current) && <p><strong>Nejbližší expirace:</strong> {effectiveExpiry(current)?.date}
                  {" · " + effectiveExpiry(current)?.reason}</p>}
                {current.openedOn && <p><strong>Otevřeno:</strong> {current.openedOn}</p>}
                {current.expiresOn && <p><strong>Expirace:</strong> {current.expiresOn}</p>}
                {current.paoMonths && <p><strong>Po otevření:</strong> {current.paoMonths} měsíců</p>}
                {shopping.some((item) => item.product.id === current.id) && <p><strong>K dokoupení</strong></p>}
                {validShopUrl(current.shopUrl) && current.shopUrl && <a href={current.shopUrl} target="_blank" rel="noopener noreferrer">Otevřít produkt v obchodě ↗</a>}
              </div>
            </div>
            {current.stockCount != null && !current.archived && <div className="df2-inventory-quick-stock">
              <strong>Aktuální zásoba: {current.stockCount} ks</strong>
              <button type="button" aria-label={"Spotřebovat jeden kus " + current.name}
                disabled={current.stockCount <= 0} onClick={() => updateOne(current.id, { stockCount: Math.max(0, (current.stockCount ?? 0) - 1) })}>− 1 kus</button>
              <button type="button" aria-label={"Přidat jeden kus " + current.name}
                disabled={current.stockCount >= 10000} onClick={() => updateOne(current.id, { stockCount: Math.min(10000, (current.stockCount ?? 0) + 1) })}>+ 1 kus</button>
            </div>}
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
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeEditor(); }}>
          <section role="dialog" aria-modal="true" aria-label="Editor produktu" className="df2-modal df2-product-dialog">
            <header><div><h2>{store.products.some((p) => p.id === draft.id) ? "Upravit produkt" : "Nový produkt"}</h2></div>
              <button type="button" disabled={saving} aria-label="Zavřít editor produktu" onClick={() => closeEditor()}>×</button>
            </header>
            <div className="df2-product-autofill" aria-label="Automatické vyplnění produktu">
              <div className="df2-product-autofill-head">
                <span>Rychlé vložení produktu</span>
                <strong>Najít produkt a vyplnit údaje</strong>
                <small>Zadej název nebo vlož HTTPS odkaz z e-shopu či webu výrobce. Nemusíš vyplňovat celý formulář ručně.</small>
              </div>
              <div className="df2-product-autofill-search">
                <input type="text" aria-label="Název nebo odkaz na produkt" value={lookupQuery}
                  placeholder="Např. CeraVe SA Smoothing Cleanser nebo https://…"
                  onChange={(event) => setLookupQuery(event.target.value)}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData("text").trim();
                    if (/^https:\/\//i.test(pasted)) void searchProduct(pasted);
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchProduct(); } }} />
                <button type="button" disabled={lookupBusy || lookupImporting} onClick={() => void searchProduct()}>
                  {lookupBusy ? "Vyhledávám…" : "Vyhledat a doplnit"}
                </button>
              </div>
              {!lookupQuery && draft.name && <small>Už máš vyplněný název „{draft.name}“ – můžeš kliknout rovnou na Vyhledat.</small>}
              <div className="df2-product-autofill-options">
                <button type="button" disabled={lookupBusy || lookupImporting || draft.name.trim().length < 3}
                  onClick={() => void researchCurrentProduct()}>
                  {lookupImporting ? "Dohledávám…" : "Doplnit návod a rizika k tomuto produktu"}
                </button>
                <label><input type="checkbox" checked={overwriteKnown} onChange={(event) => setOverwriteKnown(event.target.checked)} />
                  Nahradit také existující texty nově nalezenými údaji
                </label>
                {isCatalogBoilerplate(draft.description) && <p className="df2-product-autofill-note">
                  Současný popis pochází z katalogového výpisu složení, nikoli z návodu. Po dohledání se může nahradit užitečnějším popisem.
                </p>}
              </div>
              {lookupError && <p className="df2-hygiene-error" role="alert">{lookupError}</p>}
              {lookupNotice && <p className="df2-product-autofill-note" role="status">{lookupNotice}</p>}
              {lookupImporting && <p className="df2-product-autofill-note" role="status">Dohledávám návod a případnou fotografii…</p>}
              {lookupSource && <p className="df2-product-autofill-credit">Zdroj vyplněných údajů: {lookupSource}</p>}
              {lookupMatches.length > 0 && <div className="df2-product-autofill-results" aria-label="Nalezené produkty">
                {lookupMatches.map((match, index) => (
                  <article key={match.sourceUrl + ":" + index}>
                    <div><strong>{match.name}</strong>
                      <small>{[match.brand, match.amount, match.category].filter(Boolean).join(" · ")}</small>
                      <span>{match.sourceLabel}</span>
                      {match.description && <p>{match.description.slice(0, 220)}</p>}
                      {(match.instructions || match.precautions) && <small>Obsahuje také pokyny k použití nebo upozornění</small>}
                    </div>
                    <button type="button" onClick={() => void applyLookupMatch(match)} disabled={lookupImporting}>Použít tento produkt</button>
                  </article>
                ))}
              </div>}
            </div>
            <div className="df2-product-photo-editor">
              {uploadPreview ? <span className="df2-product-photo is-large"><img src={uploadPreview} alt="Náhled nahrané fotografie" /></span> :
                <ProductPhoto photoKey={draft.photoKey} name={draft.name || "Produkt"} large />}
              <div><label className="df2-product-file-picker">Nahrát / vyměnit fotografii
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Fotografie produktu" onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  const invalid = selected && validateProductPhoto(selected);
                  setEditError(invalid || "");
                  photoPreferenceRef.current = "manual";
                  setPhotoNotice(selected && !invalid ? "Použije se tvoje nahraná fotografie." : "");
                  setFile(invalid ? null : selected);
                  event.target.value = "";
                }} />
              </label>
              <small>JPG, PNG nebo WebP · do 6 MB</small>
              <button type="button" className="df2-find-packshot" disabled={photoBusy || lookupImporting || draft.name.trim().length < 3}
                onClick={() => {
                  photoPreferenceRef.current = "automatic";
                  void findProductPhoto(draft.name, draft.brand, draft.shopUrl, "", true, draft.id);
                }}>
                {photoBusy ? "Hledám fotografii…" : "Najít lepší fotku"}
              </button>
              {photoNotice && <small className="df2-packshot-notice" role="status">{photoNotice}</small>}
              {(draft.photoKey || file) && <button type="button" onClick={() => {
                photoPreferenceRef.current = "manual";
                setPhotoNotice("");
                setFile(null); setDraft({ ...draft, photoKey: undefined });
              }}>Odebrat fotografii</button>}</div>
            </div>
            <div className="df2-product-form-grid">
              <label>Název produktu *<input autoFocus maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label>Značka<input maxLength={160} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
              <label>Kategorie<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                {CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Frekvence podle obalu / vlastní<input value={draft.frequency} placeholder="Např. dle návodu, 2× týdně" onChange={(event) => setDraft({ ...draft, frequency: event.target.value })} /></label>
              <label className="is-wide">Popis a účel<textarea rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <label className="is-wide">Návod k použití<textarea rows={3} value={draft.instructions} placeholder="Jen skutečné pokyny z etikety nebo vlastní postup" onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
              <label>Kdy používat<input maxLength={400} value={draft.usageWhen ?? ""} placeholder="Např. po očištění pleti" onChange={(event) => setDraft({ ...draft, usageWhen: event.target.value })} /></label>
              <label>Množství na jedno použití<input maxLength={400} value={draft.usageAmount ?? ""} placeholder="Podle etikety" onChange={(event) => setDraft({ ...draft, usageAmount: event.target.value })} /></label>
              <label>Jak dlouho používat / nechat působit<input maxLength={400} value={draft.usageDuration ?? ""} placeholder="Vyplň jen ověřený údaj" onChange={(event) => setDraft({ ...draft, usageDuration: event.target.value })} /></label>
              <label className="is-wide">Upozornění a omezení<textarea rows={3} maxLength={2700} value={draft.precautions ?? ""} placeholder="Pouze známá omezení, např. z etikety" onChange={(event) => setDraft({ ...draft, precautions: event.target.value })} /></label>
              <label>Datum otevření<input type="date" value={draft.openedOn} onChange={(event) => setDraft({ ...draft, openedOn: event.target.value })} /></label>
              <label>Expirace (pokud známá)<input type="date" value={draft.expiresOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} /></label>
              <label>Trvanlivost po otevření (měsíce)<input type="number" min={1} max={60} value={draft.paoMonths ?? ""} onChange={(event) => setDraft({ ...draft, paoMonths: event.target.value ? Math.min(60, Math.max(1, Math.round(Number(event.target.value) || 1))) : null })} /></label>
              <label>Velikost balení<input value={draft.amount} placeholder="Např. 50 ml" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
              <label>Počet balení / kusů na skladě<input type="number" min={0} max={10000}
                placeholder="Nesleduji počet" value={draft.stockCount ?? ""}
                onChange={(event) => setDraft({ ...draft, stockCount: event.target.value === "" ? null :
                  Math.max(0, Math.min(10000, Math.floor(Number(event.target.value)) || 0)) })} /></label>
              <label>Dokoupit při zásobě ≤<input type="number" min={0} max={10000}
                placeholder="Bez automatického upozornění" value={draft.stockMinimum ?? ""}
                onChange={(event) => setDraft({ ...draft, stockMinimum: event.target.value === "" ? null :
                  Math.max(0, Math.min(10000, Math.floor(Number(event.target.value)) || 0)) })} /></label>
              <label>Cena za balení / kus (Kč)<input type="number" min={0} max={1000000} step="0.01"
                value={draft.priceCzk ?? ""} placeholder="Neznámá" onChange={(event) => setDraft({ ...draft,
                  priceCzk: event.target.value === "" ? null :
                    Math.max(0, Math.min(1000000, Number(event.target.value) || 0)) })} /></label>
              <label>Vyměnit pomůcku každých (dní)<input type="number" min={1} max={3650}
                value={draft.replacementEveryDays ?? ""} placeholder="Bez intervalu"
                onChange={(event) => setDraft({ ...draft, replacementEveryDays: event.target.value === "" ? null :
                  Math.max(1, Math.min(3650, Math.floor(Number(event.target.value)) || 1)) })} /></label>
              <label>Naposledy vyměněno<input type="date" value={draft.lastReplacedOn ?? ""}
                onChange={(event) => setDraft({ ...draft, lastReplacedOn: event.target.value })} /></label>
              <p className="df2-inventory-form-note">Zásoby v kusech se nesnižují automaticky odškrtnutím rutiny.
                Datum expirace a otevření vyplň podle konkrétního balení; zakoupení nového produktu je samo nepřepisuje.</p>
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
              <button type="button" className="df2-primary" disabled={saving || lookupImporting || photoBusy || !draft.name.trim()} onClick={() => void save()}>{saving ? "Ukládám…" : "Uložit produkt"}</button>
              <button type="button" disabled={saving} onClick={() => closeEditor()}>Zrušit</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
