"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { supabase } from "@/lib/supabase";
import { PHOTO_FORMATS, PHOTO_MAX_BYTES } from "@/lib/photos/assets";
import { folderLabel, sanitizeFolderInput } from "@/lib/photos/folders";
import { backdropDismissProps, Presence } from "@/app/ui/modal";

type Photo = {
  id: string;
  assetId: string;
  folder: string;
  folderLabel: string;
  name: string;
  width: number | null;
  height: number | null;
  takenAt: string;
  thumbUrl: string;
  previewUrl: string;
  fullUrl: string;
};
type PhotoFolder = { folder: string; label: string; count: number; latestAt?: string };
type PhotoDiagnostics = { rootFolder: string; hint?: string; accountImages?: number; matching?: number; folders?: { name: string; count: number }[]; error?: string };
type PhotoPage = { photos: Photo[]; page: number; pageCount: number; pageSize: number; total: number; folders: PhotoFolder[]; canManage: boolean; diagnostics?: PhotoDiagnostics; error?: string };
type LoadState = "loading" | "ready" | "error";

const authHeaders = async (): Promise<Record<string, string>> => {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()), ...(init.headers || {}) }, cache: "no-store" });
  const payload = await response.json().catch(() => ({ error: "Phản hồi không hợp lệ từ máy chủ." })) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Có lỗi xảy ra.");
  return payload;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function PhotoGallery() {
  preconnect("https://res.cloudinary.com");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [pageSize, setPageSize] = useState(18);
  const [state, setState] = useState<LoadState>("loading");
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PhotoDiagnostics | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const requestId = useRef(0);
  const panel = useRef<HTMLElement | null>(null);

  // Loads one numbered page. `select` picks the photo to show in the preview afterwards
  // (used when the preview steps across a page boundary).
  const loadPage = useCallback(async (folder: string | null, pageNumber: number, select?: "first" | "last" | number, q = "") => {
    const id = ++requestId.current;
    setError("");
    setPageLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pageNumber) });
      if (folder !== null) params.set("folder", folder);
      if (q) params.set("q", q);
      const result = await api<PhotoPage>(`/api/photos?${params.toString()}`);
      if (id !== requestId.current) return;
      setPhotos(result.photos);
      setPage(result.page);
      setPageCount(result.pageCount);
      setPageSize(result.pageSize);
      setTotal(result.total);
      setFolders(result.folders);
      setCanManage(result.canManage);
      setDiagnostics(result.diagnostics ?? null);
      setState("ready");
      if (select === undefined) return;
      if (!result.photos.length) return setPreviewIndex(null);
      setPreviewIndex(select === "first" ? 0 : select === "last" ? result.photos.length - 1 : Math.min(select, result.photos.length - 1));
    } catch (loadError) {
      if (id !== requestId.current) return;
      setError(loadError instanceof Error ? loadError.message : "Không tải được kho ảnh.");
      setState("error");
    } finally {
      if (id === requestId.current) setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPage(null, 1);
  }, [loadPage]);

  // Search as you type, after a short pause; results always start from page 1.
  useEffect(() => {
    const value = search.trim();
    if (value === query) return;
    const timer = window.setTimeout(() => {
      setQuery(value);
      setPreviewIndex(null);
      void loadPage(activeFolder, 1, undefined, value);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeFolder, loadPage, query, search]);

  const goToPage = (pageNumber: number) => {
    if (pageNumber < 1 || pageNumber > pageCount || pageNumber === page) return;
    void loadPage(activeFolder, pageNumber, undefined, query);
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectFolder = (folder: string | null) => {
    setActiveFolder(folder);
    setPreviewIndex(null);
    setState("loading");
    void loadPage(folder, 1, undefined, query);
  };

  // Preview navigation that crosses into the previous/next page when needed.
  const navigatePreview = (delta: number) => {
    if (previewIndex === null) return;
    const next = previewIndex + delta;
    if (next >= 0 && next < photos.length) return setPreviewIndex(next);
    if (next < 0 && page > 1) void loadPage(activeFolder, page - 1, "last", query);
    if (next >= photos.length && page < pageCount) void loadPage(activeFolder, page + 1, "first", query);
  };

  // After a delete the current page is reloaded so it refills from the next page.
  const removePhoto = () => {
    void loadPage(activeFolder, page, previewIndex ?? undefined, query);
  };

  const allCount = folders.reduce((sum, folder) => sum + folder.count, 0);
  const latestAt = folders.reduce<string | null>((latest, folder) => (folder.latestAt && (!latest || folder.latestAt > latest) ? folder.latestAt : latest), null);
  const firstOnPage = (page - 1) * pageSize;

  return <div className="photo-page">
    <section className="panel elo-hero-panel photo-hero-panel">
      <div className="elo-hero-copy">
        <p className="eyebrow">KHO ẢNH CLB</p>
        <h2>Kho ảnh Anh Em IT</h2>
        <p>Ảnh các buổi chơi, giải đấu và sự kiện của CLB. Mở một ảnh để xem lớn, chuyển ảnh bằng phím mũi tên hoặc vuốt trên điện thoại.</p>
      </div>
      <div className="elo-hero-stats" aria-label="Tổng quan kho ảnh">
        <div><span>Tổng ảnh</span><b>{allCount}</b></div>
        <div><span>Danh mục</span><b>{folders.length}</b></div>
        <div><span>Mới nhất</span><b>{latestAt ? `${String(new Date(latestAt).getDate()).padStart(2, "0")}/${String(new Date(latestAt).getMonth() + 1).padStart(2, "0")}` : "—"}</b></div>
      </div>
    </section>

    <section className="panel photo-panel" ref={panel}>
    <div className="panel-head photo-panel-head">
      <div><h2>Những khoảnh khắc cùng anh em</h2></div>
    </div>

    {(allCount > 0 || query || canManage) && <div className="photo-toolbar">
      <label className="photo-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên ảnh…" aria-label="Tìm theo tên ảnh" maxLength={100} />
      </label>
      <select className="photo-folder-select" value={activeFolder ?? ALL_FOLDERS} onChange={(event) => selectFolder(event.target.value === ALL_FOLDERS ? null : event.target.value)} aria-label="Lọc theo danh mục">
        <option value={ALL_FOLDERS}>Tất cả danh mục ({allCount})</option>
        {folders.map((folder) => <option key={folder.folder} value={folder.folder}>{folder.label} ({folder.count})</option>)}
      </select>
      {canManage && <button type="button" className="primary photo-upload-btn" onClick={() => setUploadOpen(true)}>+ Tải ảnh</button>}
    </div>}

    {state === "loading" && <div className="photo-grid" aria-busy="true" aria-label="Đang tải ảnh">
      {Array.from({ length: 12 }, (_, index) => <div className="photo-tile photo-skeleton" key={index} />)}
    </div>}

    {state === "error" && <div className="photo-state photo-state-error" role="alert">
      <p>{error}</p>
      <button type="button" className="soft-btn" onClick={() => void loadPage(activeFolder, page, undefined, query)}>Thử lại</button>
    </div>}

    {state === "ready" && photos.length === 0 && <div className="photo-state">
      <p className="photo-state-title">{query ? `Không tìm thấy ảnh nào có tên chứa “${query}”.` : `Chưa có ảnh nào${activeFolder !== null ? " trong danh mục này" : ""}.`}</p>
      {!query && <p>{canManage ? "Bấm “+ Tải ảnh” hoặc tải trực tiếp lên Cloudinary để bắt đầu." : "Ảnh sẽ xuất hiện ở đây khi Admin tải lên."}</p>}
      {diagnostics && <div className="photo-diagnostics">
        <b>Kiểm tra Cloudinary (chỉ Admin thấy)</b>
        {diagnostics.hint && <p className="photo-diagnostics-hint">{diagnostics.hint}</p>}
        {diagnostics.error
          ? <p>Không đọc được Cloudinary: {diagnostics.error}</p>
          : <>
            <p>Thư mục gốc đang cấu hình: <code>{diagnostics.rootFolder}</code> · Cloudinary có <b>{diagnostics.accountImages}</b> ảnh, khớp thư mục gốc: <b>{diagnostics.matching}</b>.</p>
            {Boolean(diagnostics.folders?.length) && <p>Các thư mục đang có ảnh: {diagnostics.folders!.map((item) => <code key={item.name}>{item.name} ({item.count})</code>)}</p>}
          </>}
      </div>}
    </div>}

    {state === "ready" && photos.length > 0 && <>
      <div className={`photo-grid${pageLoading ? " is-loading" : ""}`} aria-busy={pageLoading}>
        {photos.map((photo, index) => <PhotoTile key={photo.id} photo={photo} onOpen={() => setPreviewIndex(index)} />)}
      </div>
      <PhotoPagination page={page} pageCount={pageCount} from={firstOnPage + 1} to={firstOnPage + photos.length} total={total} disabled={pageLoading} onPage={goToPage} />
    </>}

    <Presence show={previewIndex !== null && photos[previewIndex] !== undefined}>{previewIndex !== null && photos[previewIndex] && <PhotoPreview
      photos={photos}
      index={previewIndex}
      position={firstOnPage + previewIndex + 1}
      total={total}
      canPrev={previewIndex > 0 || page > 1}
      canNext={previewIndex < photos.length - 1 || page < pageCount}
      canManage={canManage}
      onNavigate={navigatePreview}
      onClose={() => setPreviewIndex(null)}
      onDeleted={removePhoto}
      onRenamed={(renamed) => setPhotos((current) => current.map((item) => (item.id === renamed.id ? renamed : item)))}
    />}</Presence>

    <Presence show={uploadOpen}>{uploadOpen && <PhotoUploadModal folders={folders} defaultFolder={activeFolder ?? folders[0]?.folder ?? ""} onClose={() => setUploadOpen(false)} onUploaded={(folder) => { setActiveFolder(folder); setSearch(""); setQuery(""); void loadPage(folder, 1); }} />}</Presence>
    </section>
  </div>;
}

// Page numbers with ellipses: always the first and last page, plus neighbours of the current one.
function pageItems(page: number, pageCount: number): (number | "gap")[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) items.push("gap");
    items.push(value);
  });
  return items;
}

function PhotoPagination({ page, pageCount, from, to, total, disabled, onPage }: { page: number; pageCount: number; from: number; to: number; total: number; disabled: boolean; onPage: (page: number) => void }) {
  return <div className="photo-pagination" role="navigation" aria-label="Phân trang kho ảnh">
    <span className="photo-pagination-info">{from}–{to} / {total} ảnh</span>
    {pageCount > 1 && <div className="photo-pagination-pages">
      <button type="button" onClick={() => onPage(page - 1)} disabled={disabled || page <= 1} aria-label="Trang trước">‹</button>
      {pageItems(page, pageCount).map((item, index) => item === "gap"
        ? <span className="photo-pagination-gap" key={`gap-${index}`}>…</span>
        : <button type="button" key={item} className={item === page ? "active" : ""} aria-current={item === page ? "page" : undefined} onClick={() => onPage(item)} disabled={disabled}>{item}</button>)}
      <button type="button" onClick={() => onPage(page + 1)} disabled={disabled || page >= pageCount} aria-label="Trang sau">›</button>
    </div>}
  </div>;
}

function PhotoTile({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return <button type="button" className={`photo-tile${broken ? " photo-tile-broken" : ""}`} onClick={onOpen} aria-label={`Xem ảnh ${photo.name}`}>
    {broken
      ? <span className="photo-broken-text">Không tải được ảnh</span>
      // Plain <img>: Cloudinary already serves resized thumbnails; next/image would proxy them through Vercel.
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={photo.thumbUrl} alt={photo.name} loading="lazy" decoding="async" width={480} height={480} onError={() => setBroken(true)} />}
  </button>;
}

function PhotoPreview({ photos, index, position, total, canPrev, canNext, canManage, onNavigate, onClose, onDeleted, onRenamed }: {
  photos: Photo[];
  index: number;
  position: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  canManage: boolean;
  onNavigate: (delta: number) => void;
  onClose: () => void;
  onDeleted: (photoId: string) => void;
  onRenamed: (photo: Photo) => void;
}) {
  const photo = photos[index];
  const touchStart = useRef<number | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  // "native" = Fullscreen API, "overlay" = fixed CSS fallback (iPhone Safari has no element fullscreen).
  const [fullscreenMode, setFullscreenMode] = useState<"none" | "native" | "overlay">("none");
  const fullscreen = fullscreenMode !== "none";
  const go = useCallback((delta: number) => {
    if ((delta < 0 && !canPrev) || (delta > 0 && !canNext)) return;
    setActionError("");
    setEditing(false);
    onNavigate(delta);
  }, [canNext, canPrev, onNavigate]);

  // Lock page scrolling behind the preview.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Preload both neighbours with the same srcset/sizes the stage uses, so stepping is instant.
  useEffect(() => {
    [photos[index + 1], photos[index - 1]].forEach((neighbour) => {
      if (!neighbour) return;
      const image = new Image();
      image.sizes = PREVIEW_SIZES;
      image.srcset = `${neighbour.previewUrl} 1280w, ${neighbour.fullUrl} 1920w`;
      image.src = neighbour.previewUrl;
    });
  }, [index, photos]);

  // Native fullscreen when available; otherwise a fixed overlay (e.g. iPhone Safari).
  const toggleFullscreen = () => {
    const node = stage.current;
    if (!node) return;
    if (fullscreenMode === "native") {
      void document.exitFullscreen();
      return;
    }
    if (fullscreenMode === "overlay") {
      setFullscreenMode("none");
      return;
    }
    if (node.requestFullscreen) node.requestFullscreen().catch(() => setFullscreenMode("overlay"));
    else setFullscreenMode("overlay");
  };

  useEffect(() => {
    const sync = () => setFullscreenMode((mode) => (document.fullscreenElement ? "native" : mode === "native" ? "none" : mode));
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (confirmDelete || editing) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Escape") {
        // Esc leaves the overlay fallback first; native fullscreen exits on its own.
        if (fullscreenMode === "overlay") setFullscreenMode("none");
        else if (fullscreenMode === "none") onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, editing, fullscreenMode, go, onClose]);

  const startRename = () => {
    setDraftName(photo.name);
    setActionError("");
    setEditing(true);
  };

  const saveRename = async () => {
    const name = draftName.trim();
    if (!name || name === photo.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ photo: Photo }>(`/api/photos/${photo.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      onRenamed(result.photo);
      setEditing(false);
    } catch (renameError) {
      setActionError(renameError instanceof Error ? renameError.message : "Không đổi được tên ảnh.");
    } finally {
      setBusy(false);
    }
  };

  const deletePhoto = async () => {
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/photos/${photo.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      onDeleted(photo.id);
    } catch (deleteFailure) {
      setConfirmDelete(false);
      setActionError(deleteFailure instanceof Error ? deleteFailure.message : "Không xóa được ảnh.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop photo-preview-backdrop" role="dialog" aria-modal="true" aria-label={`Ảnh ${position} trên ${total}`} {...backdropDismissProps(() => { if (!busy && !editing) onClose(); })}>
    <section className="photo-preview">
      <header className="photo-preview-header">
        <p className="eyebrow">{photo.folderLabel} · {new Date(photo.takenAt).toLocaleDateString("vi-VN")}</p>
        {editing
          ? <form className="photo-rename" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={100} autoFocus disabled={busy} aria-label="Tên ảnh mới"
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(false); } }} />
            <button type="submit" className="primary" disabled={busy || !draftName.trim()}>{busy ? "Đang lưu…" : "Lưu"}</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={busy}>Hủy</button>
          </form>
          : <h2 title={photo.name}>{photo.name}</h2>}
        <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">×</button>
      </header>

      <div ref={stage} className={`photo-preview-stage${fullscreenMode === "overlay" ? " is-fullscreen" : ""}`}
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const end = event.changedTouches[0]?.clientX;
          if (start === null || end === undefined || Math.abs(end - start) < 50) return;
          go(end < start ? 1 : -1);
        }}>
        {/* The grid thumbnail is already cached: show it blurred at once while the sharp image loads. */}
        <div className="photo-preview-ambient" style={{ backgroundImage: `url("${photo.thumbUrl}")` }} aria-hidden="true" />
        {broken !== photo.id && loadedId !== photo.id && <span className="photo-preview-spinner" aria-label="Đang tải ảnh" />}
        {broken === photo.id
          ? <p className="photo-preview-broken">Không tải được ảnh này.</p>
          // eslint-disable-next-line @next/next/no-img-element -- served straight from the Cloudinary CDN
          : <img key={photo.id} className={loadedId === photo.id ? "is-loaded" : ""} src={photo.previewUrl} srcSet={`${photo.previewUrl} 1280w, ${photo.fullUrl} 1920w`} sizes={PREVIEW_SIZES} alt={photo.name} fetchPriority="high" decoding="async" onLoad={() => setLoadedId(photo.id)} onError={() => setBroken(photo.id)} />}
        <button type="button" className="photo-fullscreen-btn" onClick={toggleFullscreen} aria-label={fullscreen ? "Thoát toàn màn hình" : "Xem toàn màn hình"} title={fullscreen ? "Thoát toàn màn hình" : "Xem toàn màn hình"}>
          {fullscreen
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>}
        </button>
        <button type="button" className="photo-nav photo-nav-prev" onClick={() => go(-1)} disabled={!canPrev} aria-label="Ảnh trước">‹</button>
        <button type="button" className="photo-nav photo-nav-next" onClick={() => go(1)} disabled={!canNext} aria-label="Ảnh sau">›</button>
      </div>

      <footer className="photo-preview-footer">
        <span className="photo-counter">{position} / {total}</span>
        {actionError && <p className="photo-preview-error" role="alert">{actionError}</p>}
        {canManage && !editing && <div className="photo-preview-actions">
          <button type="button" className="photo-action-btn" onClick={startRename} disabled={busy}>Đổi tên</button>
          <button type="button" className="photo-action-btn photo-action-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>Xóa ảnh</button>
        </div>}
      </footer>
    </section>

    <Presence show={confirmDelete}>{confirmDelete && <div className="modal-backdrop photo-confirm-backdrop" role="dialog" aria-modal="true" {...backdropDismissProps(() => setConfirmDelete(false))}>
      <section className="confirm-modal">
        <h2>Xóa ảnh này?</h2>
        <p>Ảnh sẽ bị xóa vĩnh viễn trên Cloudinary và biến mất khỏi Kho ảnh.</p>
        <div className="modal-actions confirm-actions">
          <button type="button" className="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>Hủy</button>
          <button type="button" className="primary photo-danger" onClick={() => void deletePhoto()} disabled={busy}>{busy ? "Đang xóa…" : "Xóa ảnh"}</button>
        </div>
      </section>
    </div>}</Presence>
  </div>;
}

type UploadItem = { key: string; file: File; status: "pending" | "uploading" | "saving" | "done" | "error"; progress: number; message?: string };
type SignedUpload = { uploadUrl: string; apiKey: string; signature: string; folder: string; timestamp: number; allowed_formats: string };

const NEW_FOLDER = "__new__";
// The preview stage is at most ~1000px wide.
const PREVIEW_SIZES = "(max-width: 1000px) 100vw, 1000px";
const ALL_FOLDERS = "__all__";

function uploadToCloudinary(signed: SignedUpload, file: File, onProgress: (percent: number) => void) {
  return new Promise<{ asset_id: string }>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", signed.apiKey);
    form.append("timestamp", String(signed.timestamp));
    form.append("signature", signed.signature);
    form.append("folder", signed.folder);
    form.append("allowed_formats", signed.allowed_formats);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", signed.uploadUrl);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => {
      const payload = (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      if (xhr.status >= 200 && xhr.status < 300 && payload?.asset_id) resolve(payload);
      else reject(new Error(payload?.error?.message ? `Cloudinary: ${payload.error.message}` : `Cloudinary từ chối ảnh (mã ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Mất kết nối khi tải lên Cloudinary."));
    xhr.ontimeout = () => reject(new Error("Tải lên quá lâu (timeout)."));
    xhr.send(form);
  });
}

function PhotoUploadModal({ folders, defaultFolder, onClose, onUploaded }: { folders: PhotoFolder[]; defaultFolder: string; onClose: () => void; onUploaded: (folder: string) => void }) {
  const [folderChoice, setFolderChoice] = useState(folders.some((folder) => folder.folder === defaultFolder) ? defaultFolder : folders.length ? folders[0].folder : NEW_FOLDER);
  const [newFolder, setNewFolder] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const targetInput = folderChoice === NEW_FOLDER ? newFolder : folderChoice;
  const target = sanitizeFolderInput(targetInput);

  const update = (key: string, patch: Partial<UploadItem>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const added: UploadItem[] = [...fileList].map((file, index) => {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const invalidType = !file.type.startsWith("image/") && !PHOTO_FORMATS.includes(extension);
      const tooLarge = file.size > PHOTO_MAX_BYTES;
      return {
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        status: invalidType || tooLarge ? "error" : "pending",
        progress: 0,
        message: invalidType ? "Không phải file ảnh hợp lệ." : tooLarge ? `Ảnh vượt quá ${formatSize(PHOTO_MAX_BYTES)}.` : undefined,
      };
    });
    setItems((current) => [...current, ...added]);
  };

  const start = async () => {
    if (target === null) return setFormError("Tên thư mục chỉ gồm chữ thường không dấu, số, '-' hoặc '_' (ví dụ 2026/week-05).");
    const queue = items.filter((item) => item.status === "pending");
    if (!queue.length) return setFormError("Chọn ít nhất một ảnh hợp lệ.");
    setFormError("");
    setBusy(true);
    let signed: SignedUpload;
    try {
      signed = await api<SignedUpload>("/api/photos/sign", { method: "POST", body: JSON.stringify({ folder: target }) });
    } catch (signError) {
      setBusy(false);
      return setFormError(signError instanceof Error ? signError.message : "Không lấy được quyền tải ảnh.");
    }
    let uploaded = 0;
    for (const item of queue) {
      update(item.key, { status: "uploading", progress: 0, message: undefined });
      try {
        const result = await uploadToCloudinary(signed, item.file, (progress) => update(item.key, { progress }));
        update(item.key, { status: "saving", progress: 100 });
        try {
          await api("/api/photos", { method: "POST", body: JSON.stringify({ assetId: result.asset_id }) });
          update(item.key, { status: "done" });
        } catch (saveError) {
          // The image is safely on Cloudinary; the webhook or the next sync will index it.
          update(item.key, { status: "done", message: `Đã lên Cloudinary nhưng chưa vào kho (${saveError instanceof Error ? saveError.message : "lỗi lưu"}). Ảnh sẽ xuất hiện sau khi đồng bộ.` });
        }
        uploaded++;
      } catch (uploadError) {
        update(item.key, { status: "error", message: uploadError instanceof Error ? uploadError.message : "Tải ảnh thất bại." });
      }
    }
    setBusy(false);
    if (uploaded) onUploaded(target);
  };

  const pendingCount = items.filter((item) => item.status === "pending").length;
  const doneCount = items.filter((item) => item.status === "done").length;

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="photo-upload-title" {...backdropDismissProps(() => { if (!busy) onClose(); })}>
    <section className="photo-sheet">
      <header className="photo-sheet-header">
        <p className="eyebrow">KHO ẢNH</p>
        <h2 id="photo-upload-title">Tải ảnh lên</h2>
        <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Đóng">×</button>
      </header>
      <div className="photo-sheet-body">
        <label className="photo-field">Danh mục
          <select value={folderChoice} onChange={(event) => setFolderChoice(event.target.value)} disabled={busy}>
            {folders.map((folder) => <option key={folder.folder} value={folder.folder}>{folder.label} ({folder.folder || "thư mục gốc"})</option>)}
            <option value={NEW_FOLDER}>+ Danh mục mới…</option>
          </select>
        </label>
        {folderChoice === NEW_FOLDER && <label className="photo-field">Tên thư mục mới
          <input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="ví dụ 2026/week-05" disabled={busy} />
          <small>{target === null ? "Chỉ dùng chữ thường không dấu, số, '-' hoặc '_'." : `Sẽ hiển thị là “${folderLabel(target)}”.`}</small>
        </label>}
        <label className="photo-dropzone">
          <input type="file" accept="image/*" multiple disabled={busy} onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          <b>Chọn ảnh</b>
          <span>JPG, PNG, WEBP, HEIC… tối đa {formatSize(PHOTO_MAX_BYTES)} mỗi ảnh</span>
        </label>
        {formError && <p className="photo-form-error" role="alert">{formError}</p>}
        {items.length > 0 && <ul className="photo-upload-list">
          {items.map((item) => <li key={item.key} className={`photo-upload-item is-${item.status}`}>
            <div><b>{item.file.name}</b><small>{formatSize(item.file.size)}</small></div>
            <span className="photo-upload-status">{item.status === "pending" ? "Chờ tải" : item.status === "uploading" ? `${item.progress}%` : item.status === "saving" ? "Đang lưu…" : item.status === "done" ? "Xong" : "Lỗi"}</span>
            {item.status === "uploading" && <i className="photo-upload-bar" style={{ width: `${item.progress}%` }} />}
            {item.message && <p>{item.message}</p>}
          </li>)}
        </ul>}
      </div>
      <div className="modal-actions photo-sheet-footer">
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>{doneCount ? "Đóng" : "Hủy"}</button>
        <button type="button" className="primary" onClick={() => void start()} disabled={busy || !pendingCount}>{busy ? "Đang tải…" : `Tải lên${pendingCount ? ` ${pendingCount} ảnh` : ""}`}</button>
      </div>
    </section>
  </div>;
}
