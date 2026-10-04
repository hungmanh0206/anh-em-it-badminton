"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  mediumUrl: string;
  fullUrl: string;
};
type PhotoFolder = { folder: string; label: string; count: number };
type PhotoPage = { photos: Photo[]; nextCursor: string | null; total?: number; folders?: PhotoFolder[]; canManage?: boolean; error?: string };
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
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const requestId = useRef(0);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadFirstPage = useCallback(async (folder: string | null) => {
    const id = ++requestId.current;
    setState("loading");
    setError("");
    setMoreError("");
    try {
      const page = await api<PhotoPage>(`/api/photos${folder === null ? "" : `?folder=${encodeURIComponent(folder)}`}`);
      if (id !== requestId.current) return;
      setPhotos(page.photos);
      setNextCursor(page.nextCursor);
      setTotal(page.total ?? page.photos.length);
      setFolders(page.folders ?? []);
      setCanManage(Boolean(page.canManage));
      setState("ready");
    } catch (loadError) {
      if (id !== requestId.current) return;
      setError(loadError instanceof Error ? loadError.message : "Không tải được kho ảnh.");
      setState("error");
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const params = new URLSearchParams({ cursor: nextCursor });
      if (activeFolder !== null) params.set("folder", activeFolder);
      const page = await api<PhotoPage>(`/api/photos?${params.toString()}`);
      if (id !== requestId.current) return;
      setPhotos((current) => [...current, ...page.photos.filter((photo) => !current.some((existing) => existing.id === photo.id))]);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (id === requestId.current) setMoreError(loadError instanceof Error ? loadError.message : "Không tải thêm được ảnh.");
    } finally {
      if (id === requestId.current) setLoadingMore(false);
    }
  }, [activeFolder, loadingMore, nextCursor]);

  useEffect(() => {
    // Initial fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFirstPage(null);
  }, [loadFirstPage]);

  // Infinite scroll: fetch the next page when the sentinel below the grid comes into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !nextCursor || moreError) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, moreError, nextCursor]);

  const selectFolder = (folder: string | null) => {
    setActiveFolder(folder);
    setLightboxIndex(null);
    void loadFirstPage(folder);
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
    setTotal((current) => Math.max(0, current - 1));
    setLightboxIndex((index) => {
      if (index === null) return null;
      const remaining = photos.length - 1;
      return remaining <= 0 ? null : Math.min(index, remaining - 1);
    });
  };

  const allCount = folders.reduce((sum, folder) => sum + folder.count, 0);
  const refreshAfterChange = (folder: string | null = activeFolder) => {
    setActiveFolder(folder);
    void loadFirstPage(folder);
  };

  return <section className="panel photo-panel">
    <div className="panel-head photo-panel-head">
      <div><h2>Kho ảnh</h2><p>Ảnh các buổi chơi và sự kiện của CLB.</p></div>
      {canManage && <div className="photo-head-actions">
        <button type="button" className="primary" onClick={() => setUploadOpen(true)}>+ Tải ảnh</button>
      </div>}
    </div>

    {folders.length > 0 && <div className="photo-filters" role="tablist" aria-label="Lọc theo danh mục">
      <button type="button" role="tab" aria-selected={activeFolder === null} className={activeFolder === null ? "active" : ""} onClick={() => selectFolder(null)}>Tất cả <small>{allCount}</small></button>
      {folders.map((folder) => <button type="button" role="tab" key={folder.folder} aria-selected={activeFolder === folder.folder} className={activeFolder === folder.folder ? "active" : ""} onClick={() => selectFolder(folder.folder)}>{folder.label} <small>{folder.count}</small></button>)}
    </div>}

    {state === "loading" && <div className="photo-grid" aria-busy="true" aria-label="Đang tải ảnh">
      {Array.from({ length: 12 }, (_, index) => <div className="photo-tile photo-skeleton" key={index} />)}
    </div>}

    {state === "error" && <div className="photo-state photo-state-error" role="alert">
      <p>{error}</p>
      <button type="button" className="soft-btn" onClick={() => void loadFirstPage(activeFolder)}>Thử lại</button>
    </div>}

    {state === "ready" && photos.length === 0 && <div className="photo-state">
      <p className="photo-state-title">Chưa có ảnh nào{activeFolder !== null ? " trong danh mục này" : ""}.</p>
      <p>{canManage ? "Bấm “+ Tải ảnh” hoặc tải trực tiếp lên Cloudinary để bắt đầu." : "Ảnh sẽ xuất hiện ở đây khi Admin tải lên."}</p>
    </div>}

    {state === "ready" && photos.length > 0 && <>
      <div className="photo-grid">
        {photos.map((photo, index) => <PhotoTile key={photo.id} photo={photo} onOpen={() => setLightboxIndex(index)} />)}
      </div>
      <div ref={sentinel} className="photo-more">
        {loadingMore && <span className="photo-more-text">Đang tải thêm…</span>}
        {moreError && <><span className="photo-more-text">{moreError}</span><button type="button" className="soft-btn" onClick={() => void loadMore()}>Thử lại</button></>}
        {!loadingMore && !moreError && nextCursor && <button type="button" className="soft-btn" onClick={() => void loadMore()}>Tải thêm ảnh</button>}
        {!nextCursor && <span className="photo-more-text">Đã hiển thị {photos.length} / {total} ảnh</span>}
      </div>
    </>}

    <Presence show={lightboxIndex !== null && photos[lightboxIndex] !== undefined}>{lightboxIndex !== null && photos[lightboxIndex] && <PhotoLightbox
      photos={photos}
      index={lightboxIndex}
      total={total}
      hasMore={Boolean(nextCursor)}
      canManage={canManage}
      onIndexChange={setLightboxIndex}
      onNeedMore={() => void loadMore()}
      onClose={() => setLightboxIndex(null)}
      onDeleted={removePhoto}
    />}</Presence>

    <Presence show={uploadOpen}>{uploadOpen && <PhotoUploadModal folders={folders} defaultFolder={activeFolder ?? folders[0]?.folder ?? ""} onClose={() => setUploadOpen(false)} onUploaded={(folder) => refreshAfterChange(folder)} />}</Presence>
  </section>;
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

function PhotoLightbox({ photos, index, total, hasMore, canManage, onIndexChange, onNeedMore, onClose, onDeleted }: {
  photos: Photo[];
  index: number;
  total: number;
  hasMore: boolean;
  canManage: boolean;
  onIndexChange: (index: number) => void;
  onNeedMore: () => void;
  onClose: () => void;
  onDeleted: (photoId: string) => void;
}) {
  const photo = photos[index];
  const touchStart = useRef<number | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const canPrev = index > 0;
  const canNext = index < photos.length - 1 || hasMore;

  const go = useCallback((delta: number) => {
    const next = index + delta;
    if (next < 0) return;
    if (next >= photos.length) {
      if (hasMore) onNeedMore();
      return;
    }
    setDeleteError("");
    onIndexChange(next);
  }, [hasMore, index, onIndexChange, onNeedMore, photos.length]);

  // Lock page scrolling behind the viewer.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Keep a few photos loaded ahead of the viewer and warm the next image.
  useEffect(() => {
    if (hasMore && index >= photos.length - 3) onNeedMore();
    const next = photos[index + 1];
    if (next) { const image = new Image(); image.src = next.mediumUrl; }
  }, [hasMore, index, onNeedMore, photos]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (confirmDelete) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, go, onClose]);

  const deletePhoto = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/photos/${photo.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      onDeleted(photo.id);
    } catch (deleteFailure) {
      setConfirmDelete(false);
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "Không xóa được ảnh.");
    } finally {
      setDeleting(false);
    }
  };

  return <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`Ảnh ${index + 1} trên ${total}`}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
    onTouchEnd={(event) => {
      const start = touchStart.current;
      touchStart.current = null;
      const end = event.changedTouches[0]?.clientX;
      if (start === null || end === undefined || Math.abs(end - start) < 50) return;
      go(end < start ? 1 : -1);
    }}>
    <div className="photo-lightbox-top">
      <div className="photo-lightbox-meta"><b>{photo.name}</b><small>{photo.folderLabel} · {new Date(photo.takenAt).toLocaleDateString("vi-VN")}</small></div>
      <div className="photo-lightbox-actions">
        {canManage && <button type="button" className="photo-lightbox-delete" onClick={() => setConfirmDelete(true)} disabled={deleting}>Xóa ảnh</button>}
        <button type="button" className="modal-close photo-lightbox-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>
    </div>
    <div className="photo-lightbox-stage" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {broken === photo.id
        ? <p className="photo-lightbox-broken">Không tải được ảnh này.</p>
        // eslint-disable-next-line @next/next/no-img-element -- served straight from the Cloudinary CDN
        : <img key={photo.id} src={photo.fullUrl} srcSet={`${photo.mediumUrl} 1080w, ${photo.fullUrl} 1920w`} sizes="100vw" alt={photo.name} onError={() => setBroken(photo.id)} />}
    </div>
    <button type="button" className="photo-nav photo-nav-prev" onClick={() => go(-1)} disabled={!canPrev} aria-label="Ảnh trước">‹</button>
    <button type="button" className="photo-nav photo-nav-next" onClick={() => go(1)} disabled={!canNext} aria-label="Ảnh sau">›</button>
    <div className="photo-lightbox-bottom">
      {deleteError && <p className="photo-lightbox-error" role="alert">{deleteError}</p>}
      <span className="photo-counter">{index + 1} / {total}</span>
    </div>
    <Presence show={confirmDelete}>{confirmDelete && <div className="modal-backdrop photo-confirm-backdrop" role="dialog" aria-modal="true" {...backdropDismissProps(() => setConfirmDelete(false))}>
      <section className="confirm-modal">
        <h2>Xóa ảnh này?</h2>
        <p>Ảnh sẽ bị xóa vĩnh viễn trên Cloudinary và biến mất khỏi Kho ảnh.</p>
        <div className="modal-actions confirm-actions">
          <button type="button" className="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Hủy</button>
          <button type="button" className="primary photo-danger" onClick={() => void deletePhoto()} disabled={deleting}>{deleting ? "Đang xóa…" : "Xóa ảnh"}</button>
        </div>
      </section>
    </div>}</Presence>
  </div>;
}

type UploadItem = { key: string; file: File; status: "pending" | "uploading" | "saving" | "done" | "error"; progress: number; message?: string };
type SignedUpload = { uploadUrl: string; apiKey: string; signature: string; folder: string; timestamp: number; allowed_formats: string };

const NEW_FOLDER = "__new__";

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
