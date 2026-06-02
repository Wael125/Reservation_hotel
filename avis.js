/* ============================================================
   AVIS.JS — Royal Mansour — version complète
   - 1 client = 1 seul avis modifiable (UPSERT)
   - Toujours lié à la dernière réservation valide
   - Pagination fluide (slide slow-motion)
   ============================================================ */

(function () {
  'use strict';

  /* ---- État global ---- */
  let _selectedResaId = null;
  let _rating         = 0;
  let _isEdit         = false;   // true si l'utilisateur modifie un avis existant

  const MAX_CHARS    = 1000;
  const ratingLabels = ['', 'Décevant', 'Passable', 'Bien', 'Très bien', 'Excellent'];

  /* ---- État pagination ---- */
  const PAGE_SIZE = 8;
  const _state = {};

  function _getState(targetId) {
    if (!_state[targetId]) {
      _state[targetId] = { page: 0, has_more: false, loading: false };
    }
    return _state[targetId];
  }

  /* ============================================================
     DOMContentLoaded
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {

    var ta = document.getElementById('reviewComment');
    if (ta) {
      ta.setAttribute('maxlength', MAX_CHARS);
      ta.addEventListener('input', function () {
        _updateCharCount(ta.value.length);
      });
    }

    var grid = document.getElementById('testimonialsGrid');
    if (grid) {
      loadPublicReviews('testimonialsGrid', 0);
    }
  });

  /* ============================================================
     PUBLIC REVIEWS — chargement + animation slide
     ============================================================ */
  async function loadPublicReviews(targetId, page, direction) {
    page      = parseInt(page || 0, 10);
    direction = direction || 'init';

    var st = _getState(targetId);
    if (st.loading) return;
    st.loading = true;

    var target = document.getElementById(targetId);
    if (!target) { st.loading = false; return; }

    _setBtnsDisabled(targetId, true);

    var offset = page * PAGE_SIZE;

    try {
      var res  = await fetch('avis.php?action=public_reviews&limit=' + PAGE_SIZE + '&offset=' + offset);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      var reviews  = data.reviews  || [];
      st.has_more  = !!data.has_more;
      st.page      = page;

      var newHtml = reviews.length === 0
        ? '<div class="testi-empty">Aucun avis disponible pour le moment.</div>'
        : reviews.map(renderPublicReviewCard).join('');

      if (direction === 'init') {
        target.style.opacity = '0';
        target.innerHTML     = newHtml;
        _animateFadeIn(target);
      } else {
        await _slideTransition(target, newHtml, direction);
      }

      _updateTestiControls(targetId);

    } catch (err) {
      console.warn('Erreur public reviews:', err);
      target.innerHTML = '<div class="testi-empty">Impossible de charger les avis.</div>';
    }

    st.loading = false;
    _setBtnsDisabled(targetId, false);
  }

  function _slideTransition(container, newHtml, direction) {
    return new Promise(function (resolve) {
      var DURATION = 220;
      var exitX    = direction === 'next' ? '-60px' : '60px';
      var enterX   = direction === 'next' ? '60px'  : '-60px';

      container.style.transition = 'opacity ' + DURATION + 'ms cubic-bezier(.4,0,.2,1), transform ' + DURATION + 'ms cubic-bezier(.4,0,.2,1)';
      container.style.opacity    = '0';
      container.style.transform  = 'translateX(' + exitX + ')';

      setTimeout(function () {
        container.style.transition = 'none';
        container.style.transform  = 'translateX(' + enterX + ')';
        container.style.opacity    = '0';
        container.innerHTML        = newHtml;

        void container.offsetWidth;

        container.style.transition = 'opacity ' + DURATION + 'ms cubic-bezier(.4,0,.2,1), transform ' + DURATION + 'ms cubic-bezier(.4,0,.2,1)';
        container.style.opacity    = '1';
        container.style.transform  = 'translateX(0)';

        setTimeout(function () {
          container.style.transition = '';
          container.style.transform  = '';
          resolve();
        }, DURATION);
      }, DURATION);
    });
  }

  function _animateFadeIn(container) {
    container.style.transition = 'opacity 200ms cubic-bezier(.4,0,.2,1)';
    container.style.opacity    = '1';
    setTimeout(function () { container.style.transition = ''; }, 200);
  }

  function _updateTestiControls(targetId) {
    var btnNext = document.getElementById('testiNextBtn');
    var btnPrev = document.getElementById('testiPrevBtn');
    var st = _getState(targetId);
    if (btnPrev) btnPrev.style.display = st.page > 0 ? '' : 'none';
    if (btnNext) btnNext.style.display = st.has_more ? '' : 'none';
  }

  function _setBtnsDisabled(targetId, disabled) {
    var btnNext = document.getElementById('testiNextBtn');
    var btnPrev = document.getElementById('testiPrevBtn');
    if (btnNext) btnNext.disabled = disabled;
    if (btnPrev) btnPrev.disabled = disabled;
  }

  function showNextReviews() {
    var targetId = 'testimonialsGrid';
    var st = _getState(targetId);
    if (!st.has_more || st.loading) return;
    loadPublicReviews(targetId, st.page + 1, 'next');
  }

  function showPrevReviews() {
    var targetId = 'testimonialsGrid';
    var st = _getState(targetId);
    if (st.page <= 0 || st.loading) return;
    loadPublicReviews(targetId, st.page - 1, 'prev');
  }

  /* ============================================================
     RENDU CARTE AVIS PUBLIC
     ============================================================ */
  function renderPublicReviewCard(r) {
    var note      = Math.max(0, Math.min(5, parseInt(r.note || 0)));
    var prenom    = _esc(r.prenom || 'Client');
    var nom       = r.nom ? ' ' + _esc(r.nom) : '';
    var pays      = r.pays ? _esc(r.pays) : '';
    var comment   = _esc(r.commentaire || '');
    var isFemme   = String(r.genre || '').toLowerCase() === 'femme';
    var noteLabel = ratingLabels[note] || '';

    var dateHtml = '';
    if (r.created_at) {
      var d    = new Date(r.created_at);
      var mois = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
      dateHtml = d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
    }

    var starsHtml = '';
    for (var i = 1; i <= 5; i++) {
      starsHtml +=
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="' +
        (i <= note ? '#C9A84C' : 'rgba(201,168,76,.2)') +
        '" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' +
        '</svg>';
    }

    var avatarSvg = isFemme
      ? '<svg viewBox="0 0 80 80" width="44" height="44" xmlns="http://www.w3.org/2000/svg">'
          + '<circle cx="40" cy="40" r="40" fill="rgba(201,168,76,.18)"/>'
          + '<circle cx="40" cy="29" r="13" fill="#C9A84C" opacity=".9"/>'
          + '<ellipse cx="40" cy="67" rx="21" ry="13" fill="#C9A84C" opacity=".6"/>'
          + '<path d="M27 27 Q40 15 53 27" fill="none" stroke="#C9A84C" stroke-width="3.5" stroke-linecap="round" opacity=".95"/>'
          + '<path d="M25 32 Q21 40 23 45" fill="none" stroke="#C9A84C" stroke-width="2" opacity=".6"/>'
          + '<path d="M55 32 Q59 40 57 45" fill="none" stroke="#C9A84C" stroke-width="2" opacity=".6"/>'
          + '</svg>'
      : '<svg viewBox="0 0 80 80" width="44" height="44" xmlns="http://www.w3.org/2000/svg">'
          + '<circle cx="40" cy="40" r="40" fill="rgba(201,168,76,.18)"/>'
          + '<circle cx="40" cy="29" r="13" fill="#C9A84C" opacity=".9"/>'
          + '<ellipse cx="40" cy="67" rx="21" ry="13" fill="#C9A84C" opacity=".6"/>'
          + '<rect x="27" y="17" width="26" height="7" rx="3.5" fill="#C9A84C" opacity=".8"/>'
          + '</svg>';

    var paysHtml = pays
      ? '<span class="testi-country">'
          + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
          + '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>'
          + '<circle cx="12" cy="10" r="3"/></svg>'
          + pays + '</span>'
      : '';

    var commentHtml = comment
      ? '<div class="testi-comment-wrap">'
          + '<svg class="testi-quote-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">'
          + '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>'
          + '<path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>'
          + '</svg>'
          + '<p class="testi-comment-text">' + comment + '</p>'
          + '</div>'
      : '';

    var dateFooter = dateHtml
      ? '<div class="testi-date">'
          + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
          + '<rect x="3" y="4" width="18" height="18" rx="2"/>'
          + '<line x1="16" y1="2" x2="16" y2="6"/>'
          + '<line x1="8" y1="2" x2="8" y2="6"/>'
          + '<line x1="3" y1="10" x2="21" y2="10"/>'
          + '</svg>'
          + dateHtml + '</div>'
      : '';

    return '<div class="testi-card">'
      + '<div class="testi-card-meta">'
      +   '<div class="testi-card-avatar">' + avatarSvg + '</div>'
      +   '<div class="testi-card-info">'
      +     '<div class="testi-author-name">' + prenom + nom + paysHtml + '</div>'
      +     '<div class="testi-stars-wrap">' + starsHtml + '</div>'
      +     '<div class="testi-note-badge">'
      +       '<span class="testi-note-val">' + note + '/5</span>'
      +       '<span class="testi-note-label">' + noteLabel + '</span>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + commentHtml
      + '<div class="testi-card-footer">'
      +   dateFooter
      +   '<span class="testi-verified">'
      +     '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
      +     '<polyline points="20 6 9 17 4 12"/></svg>'
      +     'Séjour vérifié'
      +   '</span>'
      + '</div>'
      + '</div>';
  }

  /* ============================================================
     OPEN REVIEW MODAL
     ============================================================ */
  async function openReview() {
    _rating         = 0;
    _selectedResaId = null;
    _isEdit         = false;

    // Reset étoiles
    document.querySelectorAll('#reviewStars .star').forEach(function (s) { s.classList.remove('active'); });
    document.querySelectorAll('.star-sm').forEach(function (s) { s.classList.remove('active'); });

    var rtEl = document.getElementById('reviewRatingText');
    if (rtEl) rtEl.textContent = 'Sélectionnez une note';

    var ta = document.getElementById('reviewComment');
    if (ta) ta.value = '';
    _updateCharCount(0);

    _toggleSuccessState(false);
    _resetSubmitBtn();
    _clearError();

    var overlay = document.getElementById('reviewOverlay');
    var modal   = document.getElementById('reviewModal');
    if (overlay) overlay.classList.add('open');
    if (modal)   modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    await _loadReservation();
  }

  /* ============================================================
     LOAD RESERVATION + avis existant
     ============================================================ */
  async function _loadReservation() {
    var infoEl = document.getElementById('reviewStayInfo');
    if (!infoEl) return;

    infoEl.innerHTML = '<div class="avis-loading">Chargement…</div>';
    _disableSubmit(true);

    try {
      var res  = await fetch('avis.php?action=reservations');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      _isEdit = !!data.is_edit;

      // Pré-remplir si avis existant
      if (data.is_edit && data.existing_avis) {
        var ex = data.existing_avis;

        // Note
        if (ex.note) {
          _rating = parseInt(ex.note);
          document.querySelectorAll('#reviewStars .star').forEach(function (s) {
            s.classList.toggle('active', parseInt(s.dataset.val) <= _rating);
          });
          var rtEl = document.getElementById('reviewRatingText');
          if (rtEl) rtEl.textContent = ratingLabels[_rating] || '';
        }

        // Commentaire
        var ta = document.getElementById('reviewComment');
        if (ta && ex.commentaire) {
          ta.value = ex.commentaire;
          _updateCharCount(ex.commentaire.length);
        }
      }

      // Mettre à jour le libellé du bouton submit
      var btn = document.getElementById('avisSubmitBtn');
      if (btn) btn.textContent = _isEdit ? 'Modifier mon avis' : 'Publier mon avis';

      _renderStayInfo(data.reservation || null, data.source || 'none');

    } catch (e) {
      infoEl.innerHTML =
        '<div class="avis-error">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        + 'Impossible de charger vos informations.</div>';
      _disableSubmit(true);
    }
  }

  /* ---- Rendu carte séjour ---- */
  function _renderStayInfo(r, source) {
    var infoEl = document.getElementById('reviewStayInfo');
    if (!infoEl) return;

    if (!r || source === 'none') {
      infoEl.innerHTML =
        '<div class="avis-empty">'
        + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/><path d="M2 12h20"/><path d="M7 12V7"/></svg>'
        + '<span>Vous devez avoir effectué au moins un séjour (Checked_in, Checked_out ou Completed) pour laisser un avis.</span>'
        + '</div>';
      _disableSubmit(true);
      return;
    }

    _selectedResaId = r.id;
    _disableSubmit(false);

    var mois = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    var fmtDate = function (ds) {
      if (!ds) return '—';
      var d = new Date(ds);
      return d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
    };

    var isActive = source === 'checked_in';
    var label    = isActive ? 'Séjour en cours' : 'Dernier séjour';
    var dotCls   = isActive ? 'avis-stay-dot--active' : 'avis-stay-dot--done';
    var dotTxt   = isActive ? '●' : '✓';

    // Badge "Modification" si avis existant
    var editBadge = _isEdit
      ? '<span style="font-size:9px;font-weight:600;letter-spacing:2px;text-transform:uppercase;'
          + 'color:#f59e0b;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);'
          + 'padding:2px 8px;margin-left:8px;">Modification</span>'
      : '';

    infoEl.innerHTML =
      '<div class="avis-stay-card">'
      + '<div class="avis-stay-card-top">'
      +   '<span class="avis-stay-label">' + label + editBadge + '</span>'
      +   '<span class="avis-stay-dot ' + dotCls + '">' + dotTxt + '</span>'
      + '</div>'
      + '<div class="avis-stay-room">'
      +   _esc(r.roomType || 'Chambre')
      +   (r.roomNumber ? ' · N° ' + _esc(r.roomNumber) : '')
      + '</div>'
      + '<div class="avis-stay-dates">'
      +   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      +   '<rect x="3" y="4" width="18" height="18" rx="2"/>'
      +   '<line x1="16" y1="2" x2="16" y2="6"/>'
      +   '<line x1="8" y1="2" x2="8" y2="6"/>'
      +   '<line x1="3" y1="10" x2="21" y2="10"/>'
      +   '</svg>'
      +   fmtDate(r.checkInDate) + ' — ' + fmtDate(r.checkOutDate)
      + '</div>'
      + '</div>';
  }

  /* ============================================================
     RATING
     ============================================================ */
  function setRating(val) {
    _rating = val;
    document.querySelectorAll('#reviewStars .star').forEach(function (s) {
      s.classList.toggle('active', parseInt(s.dataset.val) <= val);
    });
    var rtEl = document.getElementById('reviewRatingText');
    if (rtEl) rtEl.textContent = ratingLabels[val] || '';
    _clearError();
  }

  function setCatRating(cat, val) {
    var catId = 'cat' + cat.charAt(0).toUpperCase() + cat.slice(1);
    document.querySelectorAll('#' + catId + ' .star-sm').forEach(function (s) {
      s.classList.toggle('active', parseInt(s.dataset.val) <= val);
    });
  }

  /* ============================================================
     SUBMIT (UPSERT — INSERT ou UPDATE)
     ============================================================ */
  async function submitReview() {
    _clearError();

    if (!_selectedResaId) { _showError('Aucune réservation éligible pour laisser un avis.'); return; }
    if (_rating === 0)    { _showError('Veuillez attribuer une note globale.'); return; }

    var commentaire = (document.getElementById('reviewComment')?.value || '').trim();
    var btn = document.getElementById('avisSubmitBtn');
    if (btn) {
      btn.disabled    = true;
      btn.textContent = _isEdit ? 'Modification en cours…' : 'Publication en cours…';
    }

try {
  var res = await fetch('avis.php', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      action:      'submit',
      note:        _rating,
      commentaire: commentaire,
    })
  });

  // Lire le texte brut d'abord pour détecter les erreurs PHP
  var rawText = await res.text();
  var data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    // PHP a retourné du HTML d'erreur — on l'affiche de façon lisible
    var phpError = rawText.replace(/<[^>]+>/g, '').trim().slice(0, 200);
    throw new Error('Erreur serveur : ' + (phpError || 'réponse invalide'));
  }

  if (data.success) {
    _toggleSuccessState(true, data.action === 'updated');
    var toastMsg = data.action === 'updated'
      ? 'Votre avis a été modifié ✨'
      : 'Merci pour votre avis ! ✨';
    if (typeof window.showToast === 'function') showToast(toastMsg);
    setTimeout(function () { closeReview(); }, 2500);
  } else {
    _showError(data.error || 'Une erreur est survenue.');
    _resetSubmitBtn();
  }
} catch (e) {
  console.error(e);
  _showError(e.message || 'Erreur inconnue.');
  _resetSubmitBtn();
}
  }

  /* ============================================================
     CLOSE
     ============================================================ */
  function closeReview() {
    var overlay = document.getElementById('reviewOverlay');
    var modal   = document.getElementById('reviewModal');
    if (overlay) overlay.classList.remove('open');
    if (modal)   modal.classList.remove('open');
    document.body.style.overflow = '';
    _clearError();
    _resetSubmitBtn();
  }

  /* ============================================================
     PUBLIC REVIEWS MODAL — scroll infini
     ============================================================ */
  var _modalScrollState = { offset: 0, has_more: true, loading: false };
  var _MODAL_BATCH = 20;

  async function openPublicReviews() {
    var overlay = document.getElementById('publicReviewsOverlay');
    var modal   = document.getElementById('publicReviewsModal');
    var body    = document.getElementById('publicReviewsBody');
    if (!overlay || !modal || !body) return;

    _modalScrollState = { offset: 0, has_more: true, loading: false };
    body.innerHTML = '<div class="avis-loading">Chargement des avis…</div>';

    overlay.classList.add('open');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    await _loadModalBatch();

    modal.removeEventListener('scroll', _onModalScroll);
    modal.addEventListener('scroll', _onModalScroll);
  }

  function _onModalScroll() {
    var modal = document.getElementById('publicReviewsModal');
    if (!modal) return;
    var nearBottom = modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 200;
    if (nearBottom && _modalScrollState.has_more && !_modalScrollState.loading) {
      _loadModalBatch();
    }
  }

  async function _loadModalBatch() {
    if (_modalScrollState.loading || !_modalScrollState.has_more) return;
    _modalScrollState.loading = true;

    var body = document.getElementById('publicReviewsBody');
    if (!body) { _modalScrollState.loading = false; return; }

    var spinner = null;
    if (_modalScrollState.offset > 0) {
      spinner = document.createElement('div');
      spinner.className = 'avis-loading modal-spinner';
      spinner.innerHTML = 'Chargement…';
      body.appendChild(spinner);
    }

    try {
      var res  = await fetch('avis.php?action=public_reviews&limit=' + _MODAL_BATCH + '&offset=' + _modalScrollState.offset);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var reviews = data.reviews || [];

      if (spinner) spinner.remove();

      if (_modalScrollState.offset === 0) {
        body.innerHTML = reviews.length === 0
          ? '<div class="testi-empty">Aucun avis disponible.</div>'
          : '';
      }

      reviews.forEach(function (r) {
        var tmp = document.createElement('div');
        tmp.innerHTML = renderPublicReviewCard(r);
        var el = tmp.firstElementChild;
        if (el) {
          el.style.opacity    = '0';
          el.style.transition = 'opacity 250ms ease';
          body.appendChild(el);
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { el.style.opacity = '1'; });
          });
        }
      });

      _modalScrollState.offset  += reviews.length;
      _modalScrollState.has_more = !!data.has_more;

      if (!_modalScrollState.has_more && _modalScrollState.offset > 0) {
        var end = document.createElement('div');
        end.className   = 'modal-reviews-end';
        end.textContent = '— ' + _modalScrollState.offset + ' avis au total —';
        body.appendChild(end);
      }

    } catch (err) {
      console.warn('Erreur modal reviews:', err);
      if (spinner) spinner.remove();
      if (_modalScrollState.offset === 0) {
        body.innerHTML = '<div class="testi-empty">Impossible de charger les avis.</div>';
      }
    }

    _modalScrollState.loading = false;
  }

  function closePublicReviews() {
    var overlay = document.getElementById('publicReviewsOverlay');
    var modal   = document.getElementById('publicReviewsModal');
    if (overlay) overlay.classList.remove('open');
    if (modal) {
      modal.classList.remove('open');
      modal.removeEventListener('scroll', _onModalScroll);
    }
    document.body.style.overflow = '';
  }

  /* ============================================================
     ÉTAT SUCCÈS
     ============================================================ */
  function _toggleSuccessState(show, isUpdate) {
    var body    = document.querySelector('.review-modal-body');
    var footer  = document.querySelector('.review-modal-footer');
    var success = document.getElementById('avisSuccessState');

    if (show) {
      var titre = isUpdate ? 'Avis modifié !' : 'Merci pour votre avis !';
      var sousTitre = isUpdate
        ? 'Votre avis a bien été mis à jour.<br>Merci de nous aider à nous améliorer.'
        : 'Votre retour a bien été publié.<br>Nous vous en remercions sincèrement.';

      if (!success) {
        success = document.createElement('div');
        success.id        = 'avisSuccessState';
        success.className = 'avis-success-state';
        var modal = document.getElementById('reviewModal');
        if (modal) modal.appendChild(success);
      }
      success.innerHTML =
          '<div class="avis-success-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>'
        + '<div class="avis-success-title">' + titre + '</div>'
        + '<div class="avis-success-sub">' + sousTitre + '</div>';
      success.style.display = 'flex';
      if (body)   body.style.display   = 'none';
      if (footer) footer.style.display = 'none';
    } else {
      if (success) success.style.display = 'none';
      if (body)   body.style.display   = '';
      if (footer) footer.style.display = '';
    }
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function _updateCharCount(len) {
    var el = document.getElementById('avisCharCount');
    if (!el) return;
    el.textContent = len + ' / ' + MAX_CHARS;
    el.classList.toggle('warn', len > MAX_CHARS * 0.9);
  }

  function _showError(msg) {
    var el = document.getElementById('avisModalError');
    if (!el) {
      el = document.createElement('div');
      el.id        = 'avisModalError';
      el.className = 'avis-modal-error';
      var footer   = document.querySelector('.review-modal-footer');
      if (footer) footer.before(el);
    }
    el.textContent   = msg;
    el.style.display = 'block';
  }

  function _clearError() {
    var el = document.getElementById('avisModalError');
    if (el) el.style.display = 'none';
  }

  function _disableSubmit(disabled) {
    var btn = document.getElementById('avisSubmitBtn');
    if (btn) btn.disabled = disabled;
  }

  function _resetSubmitBtn() {
    var btn = document.getElementById('avisSubmitBtn');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = _isEdit ? 'Modifier mon avis' : 'Publier mon avis';
    }
  }

  function _esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (ch) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[ch];
    });
  }

  /* ============================================================
     EXPOSITION GLOBALE
     ============================================================ */
  window.openReview         = openReview;
  window.closeReview        = closeReview;
  window.setRating          = setRating;
  window.setCatRating       = setCatRating;
  window.submitReview       = submitReview;
  window.openPublicReviews  = openPublicReviews;
  window.closePublicReviews = closePublicReviews;
  window.loadPublicReviews  = loadPublicReviews;
  window.showNextReviews    = showNextReviews;
  window.showPrevReviews    = showPrevReviews;

})();