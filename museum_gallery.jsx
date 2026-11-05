// MuseumGallery.jsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateAgeAtDate } from './src/age_calculation.mjs';

const errorTextKeys = {
  'Choose an image to upload.': 'chooseImageError',
  'Provide a title, valid age, medium, and category.': 'metadataError',
  'Provide a title, valid age, medium, and at least one section.': 'metadataError',
  'Images must be 20 MB or smaller.': 'imageSizeError',
  'Choose a JPG, PNG, WebP, or GIF image.': 'imageTypeError',
  'Artwork was not found.': 'notFoundError',
  'The gallery could not complete that request.': 'requestError',
  'Choose no more than 5 images.': 'tooManyImagesError',
};

function getDrawingCategories(drawing) {
  return Array.isArray(drawing.categories) && drawing.categories.length > 0
    ? drawing.categories
    : [drawing.category];
}
function formatText(template, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

function ArtworkWatermark({ artwork, author, opacity, fontSize }) {
  const year = String(artwork?.date || '').slice(0, 4);
  if (!author || !/^\d{4}$/.test(year)) return null;

  const copyright = `© ${year} ${author}`;
  return (
    <div
      className="artwork-copyright-pattern"
      style={{
        '--artwork-watermark-opacity': opacity,
        '--artwork-watermark-font-size': fontSize,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: 12 }, (_, index) => <span key={index}>{copyright}</span>)}
    </div>
  );
}

export default function MuseumGallery() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const text = i18n.getResourceBundle(language, 'translation') || i18n.getResourceBundle('en', 'translation');
  const [drawings, setDrawings] = useState([]);
  const [selectedArt, setSelectedArt] = useState(null);
  const [sortOrder, setSortOrder] = useState('newest');
  const [ageFilter, setAgeFilter] = useState('all');
  const [creationYearFilter, setCreationYearFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [imageOrientation, setImageOrientation] = useState(null);
  const [isOriginalImageOpen, setIsOriginalImageOpen] = useState(false);
  const [filter, setFilter] = useState('All');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadAge, setUploadAge] = useState('');
  const [uploadDate, setUploadDate] = useState('');
  const [authorBirthday, setAuthorBirthday] = useState('');
  const [artworkAuthor, setArtworkAuthor] = useState('');
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.28);
  const [watermarkFontSize, setWatermarkFontSize] = useState('16px');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState([]);
  const [selectedArtworkIds, setSelectedArtworkIds] = useState(() => new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [isLoadingDrawings, setIsLoadingDrawings] = useState(true);
  const [drawingsError, setDrawingsError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isOriginalImageOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOriginalImageOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOriginalImageOpen]);

  useEffect(() => {
    let isCurrent = true;
    fetch('/api/config')
      .then((response) => {
        if (!response.ok) throw new Error(`The gallery API returned ${response.status}.`);
        return response.json();
      })
      .then((config) => {
        if (isCurrent) {
          setAuthorBirthday(config.authorBirthday || '');
          setArtworkAuthor(config.artworkAuthor || '');
          const opacity = Number(config.watermarkOpacity);
          setWatermarkOpacity(Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.28);
          setWatermarkFontSize(/^\d+(?:\.\d+)?px$/.test(config.watermarkFontSize || '') ? config.watermarkFontSize : '16px');
        }
      })
      .catch((error) => console.error('Error fetching gallery configuration:', error));

    return () => { isCurrent = false; };
  }, []);

  useEffect(() => {
    if (!uploadDate || !authorBirthday) return;
    const age = calculateAgeAtDate(uploadDate, authorBirthday);
    setUploadAge(age === null ? '' : String(age));
  }, [authorBirthday, uploadDate]);

  useEffect(() => {
    if (!isDeleteConfirmationOpen || isDeleting) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsDeleteConfirmationOpen(false);
        setDeleteTargetIds([]);
        setDeleteError('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleteConfirmationOpen, isDeleting]);

  useEffect(() => {
    let isCurrent = true;

    async function loadDrawings() {
      setIsLoadingDrawings(true);
      setDrawingsError('');
      try {
        const response = await fetch('/api/drawings');
        if (!response.ok) throw new Error(`The gallery API returned ${response.status}.`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('The gallery API returned an invalid response.');
        if (isCurrent) setDrawings(data);
      } catch (error) {
        if (isCurrent) {
          setDrawingsError('Artwork could not be loaded. Check that the API and PostgreSQL are running, then retry.');
          console.error('Error fetching art:', error);
        }
      } finally {
        if (isCurrent) setIsLoadingDrawings(false);
      }
    }

    loadDrawings();
    return () => { isCurrent = false; };
  }, [reloadKey]);

  useEffect(() => {
    if (!isUploadPanelOpen || isUploading) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsUploadPanelOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUploadPanelOpen, isUploading]);

  useEffect(() => {
    window.localStorage.setItem('gallery-language', language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const getCategoryLabel = (category) => t(`sections.${category}`, { defaultValue: category });
  const getErrorMessage = (message, fallback) => {
    const errorKey = errorTextKeys[message];
    return errorKey ? t(errorKey) : message || fallback;
  };
  const getLocalizedLabel = (label) => t(`media.${label}`, { defaultValue: label });

  const categories = ['All', ...new Set(drawings.flatMap(getDrawingCategories))];
  const ages = [...new Set(drawings.map((drawing) => Number(drawing.age)))].filter(Number.isFinite).sort((a, b) => a - b);
  const years = [...new Set(drawings.map((drawing) => String(drawing.date || '').slice(0, 4)))]
    .filter((year) => /^\d{4}$/.test(year))
    .sort((first, second) => Number(second) - Number(first));
  const sectionFilteredDrawings = filter === 'All'
    ? drawings
    : drawings.filter((drawing) => getDrawingCategories(drawing).includes(filter));
  const ageFilteredDrawings = ageFilter === 'all'
    ? sectionFilteredDrawings
    : sectionFilteredDrawings.filter((drawing) => Number(drawing.age) === Number(ageFilter));
  const yearFilteredDrawings = creationYearFilter === 'all'
    ? ageFilteredDrawings
    : ageFilteredDrawings.filter((drawing) => String(drawing.date || '').slice(0, 4) === creationYearFilter);
  const searchTerms = searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filteredDrawings = yearFilteredDrawings.filter((drawing) => {
    const searchableText = [
      drawing.id,
      drawing.title,
      drawing.description,
      drawing.date,
      drawing.age,
      drawing.medium,
      ...getDrawingCategories(drawing),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchTerms.every((term) => searchableText.includes(term));
  });
  const sortedDrawings = sortOrder === 'newest'
    ? filteredDrawings
    : [...filteredDrawings].sort((first, second) => sortOrder === 'age-ascending'
      ? Number(first.age) - Number(second.age)
      : Number(second.age) - Number(first.age));
  const visibleArtworkIds = filteredDrawings.map((drawing) => String(drawing.id));
  const allVisibleSelected = visibleArtworkIds.length > 0
    && visibleArtworkIds.every((id) => selectedArtworkIds.has(id));
  const descriptionBlock = selectedArt?.description?.trim() && (
    <div className="artwork-description">
      <strong>{text.descriptionLabel}</strong>
      {selectedArt.description
        .split(/\r?\n(?:[ \t]*\r?\n)+/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph, index) => <p key={index}>{paragraph.trim()}</p>)}
    </div>
  );

  const handleUpload = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsUploading(true);
    setUploadMessage('');
    setUploadError('');

    try {
      const response = await fetch('/api/drawings', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The artwork could not be uploaded.');

      const newDrawings = Array.isArray(result) ? result : [result];
      setDrawings((current) => [...newDrawings, ...current]);
      setFilter('All');
      form.reset();
      setUploadAge('');
      setUploadDate('');
      setUploadMessage(text.uploadSuccess);
    } catch (error) {
      setUploadError(getErrorMessage(error.message, text.uploadFailure));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    if (deleteTargetIds.length === 0 || isDeleting) return;

    setIsDeleting(true);
    setDeleteError('');
    const deletedIds = [];
    const failedIds = [];
    let firstError = '';
    for (const id of deleteTargetIds) {
      try {
        const response = await fetch(`/api/drawings/${id}`, { method: 'DELETE' });
        if (response.ok || response.status === 404) {
          deletedIds.push(String(id));
        } else {
          const result = await response.json();
          failedIds.push(String(id));
          firstError ||= result.error || text.deleteFailure;
        }
      } catch (error) {
        failedIds.push(String(id));
        firstError ||= error.message;
      }
    }

    if (deletedIds.length > 0) {
      setDrawings((current) => current.filter((drawing) => !deletedIds.includes(String(drawing.id))));
      setSelectedArtworkIds((current) => new Set([...current].filter((id) => !deletedIds.includes(id))));
      if (selectedArt && deletedIds.includes(String(selectedArt.id))) setSelectedArt(null);
    }

    if (failedIds.length > 0) {
      setDeleteTargetIds(failedIds);
      setDeleteError(getErrorMessage(firstError, text.deleteFailure));
    } else {
      setIsDeleteConfirmationOpen(false);
      setDeleteTargetIds([]);
    }
    setIsDeleting(false);
  };

  const toggleArtworkSelection = (id) => {
    const normalizedId = String(id);
    setSelectedArtworkIds((current) => {
      const next = new Set(current);
      if (next.has(normalizedId)) next.delete(normalizedId);
      else next.add(normalizedId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedArtworkIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleArtworkIds.forEach((id) => next.delete(id));
      else visibleArtworkIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!selectedArt || isSavingEdit) return;

    const formData = new FormData(event.currentTarget);
    setIsSavingEdit(true);
    setEditError('');
    try {
      const response = await fetch(`/api/drawings/${selectedArt.id}`, {
        method: 'PUT',
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The artwork could not be updated.');

      setDrawings((current) => current.map((drawing) => drawing.id === result.id ? result : drawing));
      setSelectedArt(result);
      setIsEditing(false);
    } catch (error) {
      setEditError(getErrorMessage(error.message, text.editFailure));
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="gallery-canvas min-h-screen text-[#263B38] font-serif p-8">
      <div className="language-switch" role="group" aria-label={text.language}>
        <button
          type="button"
          className={language === 'en' ? 'language-switch__button language-switch__button--active' : 'language-switch__button'}
          aria-pressed={language === 'en'}
          onClick={() => i18n.changeLanguage('en')}
        >
          {text.english}
        </button>
        <button
          type="button"
          className={language === 'zh' ? 'language-switch__button language-switch__button--active' : 'language-switch__button'}
          aria-pressed={language === 'zh'}
          onClick={() => i18n.changeLanguage('zh')}
        >
          {text.chinese}
        </button>
      </div>
      {/* Museum Header */}
      <header className="gallery-heading text-center max-w-2xl mx-auto mb-12 border-b border-[#D6B66A] pb-6">
        <h1 className="text-4xl tracking-wide uppercase font-light text-[#24443B]">{text.exhibitionTitle}</h1>
        <p className="text-sm text-[#697D72] italic mt-2">{text.exhibitionSubtitle}</p>
      </header>

      {isUploadPanelOpen && (
      <div className="upload-dialog-backdrop" onClick={() => setIsUploadPanelOpen(false)}>
      <section
        className="upload-panel upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="upload-panel__heading">
          <div>
            <p className="upload-eyebrow">{text.uploadEyebrow}</p>
            <h2 id="upload-heading">{text.uploadHeading}</h2>
          </div>
          <button
            className="upload-panel__close"
            type="button"
            onClick={() => setIsUploadPanelOpen(false)}
            aria-label={text.closeUpload}
            title={text.closeUploadTitle}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <form className="upload-form" onSubmit={handleUpload}>
          <label className="upload-field upload-field--file">
            <span>{text.image}</span>
            <input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required />
            <small>{text.fileTypes}</small>
          </label>
          <label className="upload-field">
            <span>{text.title}</span>
            <input name="title" type="text" placeholder={text.titlePlaceholder} maxLength="200" required />
          </label>
          <label className="upload-field">
            <span>{text.age}</span>
            <input
              name="age"
              type="number"
              min="0"
              max="120"
              placeholder={text.agePlaceholder}
              value={uploadAge}
              onChange={(event) => setUploadAge(event.target.value)}
              required
            />
          </label>
          <label className="upload-field">
            <span>{text.medium}</span>
            <input name="medium" type="text" placeholder={text.mediumPlaceholder} maxLength="120" required />
          </label>
          <label className="upload-field">
            <span>{text.category}</span>
            <input name="category" type="text" placeholder={text.categoryPlaceholder} maxLength="809" required />
          </label>
          <label className="upload-field upload-field--description">
            <span>{text.description}</span>
            <textarea name="description" placeholder={text.descriptionPlaceholder} maxLength="1000" rows="3" />
          </label>
          <label className="upload-field">
            <span>{text.date}</span>
            <input
              name="date"
              type="date"
              value={uploadDate}
              onChange={(event) => {
                setUploadDate(event.target.value);
                if (!event.target.value) setUploadAge('');
              }}
            />
          </label>
          <div className="upload-actions">
            <button type="submit" disabled={isUploading}>
              {isUploading ? text.uploading : text.addToCollection}
              {!isUploading && <span aria-hidden="true"> ↗</span>}
            </button>
            <p aria-live="polite" className={uploadError ? 'upload-status upload-status--error' : 'upload-status'}>
              {uploadError || uploadMessage}
            </p>
          </div>
        </form>
      </section>
      </div>
      )}

      <button
        className="upload-launcher"
        type="button"
        onClick={() => setIsUploadPanelOpen(true)}
        aria-expanded={isUploadPanelOpen}
        aria-controls="upload-heading"
      >
        <span className="upload-launcher__icon" aria-hidden="true">+</span>
        <span>{text.addArtwork}</span>
      </button>

      <section className="gallery-controls-panel" aria-label={text.searchArtwork}>
        <div className="gallery-search-bar">
          <label htmlFor="gallery-search-input">{text.searchArtwork}</label>
          <input
            id="gallery-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={text.searchPlaceholder}
          />
        </div>

        {/* Exhibition Curator Filter Tabs */}
        <div className="gallery-section-filters" role="group" aria-label={text.category}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-4 py-2 border rounded-none transition-all uppercase tracking-wider ${
                filter === cat
                  ? 'bg-[#287568] text-white border-[#287568]'
                  : 'border-[#AFC5B9] hover:border-[#C76D52] hover:bg-white/70'
              }`}
            >
              {formatText(text.sectionCount, {
                section: getCategoryLabel(cat),
                count: cat === 'All'
                  ? drawings.length
                  : drawings.filter((drawing) => getDrawingCategories(drawing).includes(cat)).length,
              })}
            </button>
          ))}
        </div>

        <div className="gallery-selection-toolbar" role="group" aria-label={text.selectArtwork}>
        <label className="gallery-sort-control">
          <span>{text.filterByYear}</span>
          <select value={creationYearFilter} onChange={(event) => setCreationYearFilter(event.target.value)}>
            <option value="all">{text.allYears}</option>
            {years.map((year) => (
              <option key={year} value={year}>{formatText(text.yearOption, { year })}</option>
            ))}
          </select>
        </label>
        <label className="gallery-sort-control">
          <span>{text.filterByAge}</span>
          <select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}>
            <option value="all">{text.allAges}</option>
            {ages.map((age) => (
              <option key={age} value={age}>{formatText(text.ageOption, { age })}</option>
            ))}
          </select>
        </label>
        <label className="gallery-sort-control">
          <span>{text.sortByAge}</span>
          <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
            <option value="newest">{text.sortNewest}</option>
            <option value="age-ascending">{text.ageLowToHigh}</option>
            <option value="age-descending">{text.ageHighToLow}</option>
          </select>
        </label>
        <button
          type="button"
          className={isSelectionMode ? 'gallery-selection-toggle gallery-selection-toggle--active' : 'gallery-selection-toggle'}
          aria-pressed={isSelectionMode}
          onClick={() => {
            setIsSelectionMode((current) => !current);
            if (isSelectionMode) setSelectedArtworkIds(new Set());
          }}
        >
          {isSelectionMode ? text.doneSelecting : text.selectArtwork}
        </button>
        {isSelectionMode && (
          <>
            <button type="button" className="gallery-selection-action" onClick={toggleVisibleSelection} disabled={visibleArtworkIds.length === 0}>
              {allVisibleSelected ? text.deselectVisible : text.selectVisible}
            </button>
            <span className="gallery-selection-count">
              {formatText(text.selectedCount, { count: selectedArtworkIds.size })}
            </span>
            <button
              type="button"
              className="gallery-selection-delete"
              disabled={selectedArtworkIds.size === 0}
              onClick={() => {
                setDeleteTargetIds([...selectedArtworkIds]);
                setDeleteError('');
                setIsDeleteConfirmationOpen(true);
              }}
            >
              {text.deleteSelected}
            </button>
          </>
        )}
        </div>
      </section>

      {/* The Gallery Wall Grid */}
      <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
        {isLoadingDrawings && <p className="gallery-feedback">{text.loading}</p>}
        {!isLoadingDrawings && drawingsError && (
          <div className="gallery-feedback gallery-feedback--error" role="alert">
            <p>{text.loadError}</p>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>{text.retry}</button>
          </div>
        )}
        {!isLoadingDrawings && !drawingsError && filteredDrawings.length === 0 && (
          <p className="gallery-feedback">
            {searchTerms.length > 0 || filter !== 'All' || ageFilter !== 'all' || creationYearFilter !== 'all'
              ? text.noSearchResults
              : text.empty}
          </p>
        )}
        {sortedDrawings.map((art) => (
          <div className="gallery-artwork-entry" key={art.id}>
            {isSelectionMode && (
              <label className="gallery-artwork-select">
                <input
                  type="checkbox"
                  checked={selectedArtworkIds.has(String(art.id))}
                  aria-label={`${text.selectionLabel}: ${art.title}`}
                  onChange={() => toggleArtworkSelection(art.id)}
                />
              </label>
            )}
            <div
              className="flex flex-col items-center group cursor-pointer"
              onClick={() => {
                if (isSelectionMode) toggleArtworkSelection(art.id);
                else { setImageOrientation(null); setSelectedArt(art); }
              }}
            >
              {/* Gallery frame and archival mat */}
              <div className="gallery-picture-frame transition-transform duration-300 group-hover:-translate-y-2">
                <div className="gallery-picture-mat">
                  <div className="gallery-picture-image">
                    <img
                      src={art.imageUrl}
                      alt={art.title}
                      className="w-48 h-48 xl:w-56 xl:h-56 object-cover transition-scale duration-500 group-hover:scale-105"
                      onContextMenu={(event) => event.preventDefault()}
                    />
                    <ArtworkWatermark artwork={art} author={art.author || artworkAuthor} opacity={watermarkOpacity} fontSize={watermarkFontSize} />
                  </div>
                </div>
              </div>

              {/* Museum Wall Placard */}
              <div className="mt-4 text-center max-w-[250px]">
                <h3 className="font-medium text-lg leading-tight group-hover:text-amber-800 transition-colors">{art.title}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {formatText(text.artworkDetails, { age: art.age, medium: getLocalizedLabel(art.medium) })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </main>

      {/* Interactive Closeup View (Light Box / Zoom Modal) */}
      {selectedArt && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity"
          onClick={() => setSelectedArt(null)}
        >
          {/* Spotlight Effect Container */}
          <div
            className="bg-[#FBF9F4] p-8 md:p-12 max-w-4xl w-full flex flex-col md:flex-row gap-8 shadow-2xl relative border-t-4 border-amber-700 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setSelectedArt(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 text-xl font-sans"
            >
              ✕
            </button>

            <div className="artwork-visual-column">
              {/* Framed Image */}
              <div className="gallery-picture-frame artwork-image-frame">
                <div className="gallery-picture-mat">
                  <button
                    type="button"
                    className="artwork-image-trigger"
                    onClick={() => setIsOriginalImageOpen(true)}
                    aria-label={text.openOriginalImage}
                    title={text.openOriginalImage}
                  >
                    <img
                      src={selectedArt.imageUrl}
                      alt={selectedArt.title}
                      className="artwork-image-frame__image"
                      onContextMenu={(event) => event.preventDefault()}
                      onLoad={(event) => {
                        const { naturalWidth, naturalHeight } = event.currentTarget;
                        setImageOrientation(naturalHeight > naturalWidth ? 'portrait' : 'landscape');
                      }}
                    />
                    <ArtworkWatermark artwork={selectedArt} author={selectedArt.author || artworkAuthor} opacity={watermarkOpacity} fontSize={watermarkFontSize} />
                  </button>
                </div>
              </div>
              {!isEditing && imageOrientation !== 'portrait' && descriptionBlock}
            </div>

            {/* Official Museum Descriptive Label */}
            <div className="w-full md:w-72 flex flex-col justify-between border-l border-gray-200 pl-0 md:pl-8 pt-4 md:pt-0">
              {isEditing ? (
                <form className="edit-artwork-form" onSubmit={handleEdit}>
                  <label className="upload-field">
                    <span>{text.title}</span>
                    <input name="title" type="text" defaultValue={selectedArt.title} maxLength="200" required />
                  </label>
                  <label className="upload-field">
                    <span>{text.age}</span>
                    <input name="age" type="number" min="0" max="120" defaultValue={selectedArt.age} required />
                  </label>
                  <label className="upload-field">
                    <span>{text.medium}</span>
                    <input name="medium" type="text" defaultValue={selectedArt.medium} maxLength="120" required />
                  </label>
                  <label className="upload-field">
                    <span>{text.category}</span>
                    <input
                      name="category"
                      type="text"
                      defaultValue={getDrawingCategories(selectedArt).join(' | ')}
                      maxLength="809"
                      required
                    />
                  </label>
                  <label className="upload-field">
                    <span>{text.description}</span>
                    <textarea name="description" defaultValue={selectedArt.description || ''} maxLength="1000" rows="3" />
                  </label>
                  <label className="upload-field">
                    <span>{text.date}</span>
                    <input name="date" type="date" defaultValue={String(selectedArt.date).slice(0, 10)} />
                  </label>
                  <label className="upload-field">
                    <span>{text.image}</span>
                    <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
                    <small>{text.fileTypes}</small>
                  </label>
                  <div className="edit-artwork-actions">
                    <button type="submit" disabled={isSavingEdit}>{isSavingEdit ? text.savingChanges : text.saveChanges}</button>
                    <button type="button" className="edit-artwork-cancel" onClick={() => { setIsEditing(false); setEditError(''); }}>{text.cancelEdit}</button>
                  </div>
                  {editError && <p className="delete-artwork-error" role="alert">{editError}</p>}
                </form>
              ) : <>
              <div>
                <h2 className="text-2xl font-light mb-1">{selectedArt.title}</h2>
                <p className="text-xs tracking-wider uppercase text-amber-800 font-sans mb-4">
                  {formatText(text.artistAge, { age: selectedArt.age })}
                </p>
                <div className="space-y-2 text-sm text-gray-600 font-sans">
                  <p><strong>{text.dateLabel}</strong> {String(selectedArt.date).slice(0, 10)}</p>
                  <p><strong>{text.mediumLabel}</strong> {selectedArt.medium}</p>
                  <p><strong>{text.authorLabel}</strong> {selectedArt.author || artworkAuthor}</p>
                  <p>
                    <strong>{text.sectionLabel}</strong>{' '}
                    {getDrawingCategories(selectedArt).map(getCategoryLabel).join(', ')}
                  </p>
                  {!isEditing && imageOrientation === 'portrait' && descriptionBlock}
                </div>
              </div>
              <div className="mt-8 pt-4 border-t border-dashed border-gray-300 text-xs italic text-gray-400 font-sans">
                {formatText(text.collectionId, { id: selectedArt.id })}
              </div>
              <button
                type="button"
                className="modify-artwork-button"
                onClick={() => { setIsEditing(true); setEditError(''); }}
                disabled={isDeleting}
              >
                {text.edit}
              </button>
              <button
                type="button"
                className="delete-artwork-button"
                onClick={() => {
                  setDeleteTargetIds([String(selectedArt.id)]);
                  setDeleteError('');
                  setIsDeleteConfirmationOpen(true);
                }}
                disabled={isDeleting}
              >
                {text.delete}
              </button>
              </>}
            </div>
          </div>
          {isOriginalImageOpen && (
            <div
              className="original-image-viewer"
              onClick={(event) => { event.stopPropagation(); setIsOriginalImageOpen(false); }}
            >
              <button
                type="button"
                className="original-image-viewer__close"
                onClick={() => setIsOriginalImageOpen(false)}
                aria-label={text.closeOriginalImage}
                title={text.closeOriginalImage}
              >
                <span aria-hidden="true">×</span>
              </button>
              <div
                className="original-image-viewer__canvas"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <img
                  src={selectedArt.imageUrl}
                  alt={selectedArt.title}
                  onContextMenu={(event) => event.preventDefault()}
                />
                <ArtworkWatermark artwork={selectedArt} author={selectedArt.author || artworkAuthor} opacity={watermarkOpacity} fontSize={watermarkFontSize} />
              </div>
              <a
                className="original-image-viewer__download"
                href={`/api/drawings/${selectedArt.id}/download`}
                onClick={(event) => event.stopPropagation()}
              >
                {text.downloadWatermarkedImage}
              </a>
            </div>
          )}
          {isDeleteConfirmationOpen && (
            <div
              className="delete-confirmation-backdrop"
              onClick={(event) => {
                event.stopPropagation();
                if (!isDeleting) {
                  setIsDeleteConfirmationOpen(false);
                  setDeleteTargetIds([]);
                  setDeleteError('');
                }
              }}
            >
              <section
                className="delete-confirmation-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-confirmation-title"
                aria-describedby="delete-confirmation-message"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="delete-confirmation-title">
                  {deleteTargetIds.length > 1 ? text.deleteMultipleConfirmationTitle : text.deleteConfirmationTitle}
                </h2>
                <p id="delete-confirmation-message">
                  {deleteTargetIds.length > 1
                    ? formatText(text.confirmDeleteSelected, { count: deleteTargetIds.length })
                    : formatText(text.confirmDelete, {
                        title: selectedArt?.title || drawings.find((drawing) => String(drawing.id) === deleteTargetIds[0])?.title || '',
                      })}
                </p>
                {deleteError && <p className="delete-confirmation-error" role="alert">{deleteError}</p>}
                <div className="delete-confirmation-actions">
                  <button
                    type="button"
                    className="delete-confirmation-cancel"
                    onClick={() => {
                      setIsDeleteConfirmationOpen(false);
                      setDeleteTargetIds([]);
                      setDeleteError('');
                    }}
                    disabled={isDeleting}
                  >
                    {text.cancelDelete}
                  </button>
                  <button type="button" className="delete-confirmation-submit" onClick={handleDelete} disabled={isDeleting}>
                    {isDeleting ? text.deleting : text.confirmDeleteAction}
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}