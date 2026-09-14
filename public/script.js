document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('generate-form');
  const seedInput = document.getElementById('seed-input');
  const generateBtn = document.getElementById('generate-btn');
  const clearBtn = document.getElementById('clear-btn');
  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');
  const resultsSection = document.getElementById('results-section');
  const variationsGrid = document.getElementById('variations-grid');
  const displaySeed = document.getElementById('display-seed');
  const copyAllBtn = document.getElementById('copy-all-btn');
  const presetBtns = document.querySelectorAll('.preset-btn');

  // PRISM Elements
  const evaluatePrismBtn = document.getElementById('evaluate-prism-btn');
  const evolvePrismBtn = document.getElementById('evolve-prism-btn');
  const prismEvalSection = document.getElementById('prism-evaluation-section');
  const prismEvolveSection = document.getElementById('prism-evolution-section');

  // PRISM Eval Scorecard elements
  const prismOverallBadge = document.getElementById('prism-overall-badge');
  const evalOverallScore = document.getElementById('eval-overall-score');
  const evalStatusLabel = document.getElementById('eval-status-label');
  const dimSemanticBar = document.getElementById('dim-semantic-bar');
  const dimSemanticVal = document.getElementById('dim-semantic-val');
  const dimDistinctBar = document.getElementById('dim-distinct-bar');
  const dimDistinctVal = document.getElementById('dim-distinct-val');
  const dimStressBar = document.getElementById('dim-stress-bar');
  const dimStressVal = document.getElementById('dim-stress-val');
  const categoryScoresContainer = document.getElementById('category-scores-container');
  const weaknessesList = document.getElementById('weaknesses-list');
  const weaknessCountBadge = document.getElementById('weakness-count-badge');
  const recommendationsList = document.getElementById('recommendations-list');

  // PRISM Evolve elements
  const evolutionDeltaBadge = document.getElementById('evolution-delta-badge');
  const evolveBeforeScore = document.getElementById('evolve-before-score');
  const evolveAfterScore = document.getElementById('evolve-after-score');
  const evolveBeforeStatus = document.getElementById('evolve-before-status');
  const evolveAfterStatus = document.getElementById('evolve-after-status');
  const evolveDeltaText = document.getElementById('evolve-delta-text');
  const resolvedWeaknessesList = document.getElementById('resolved-weaknesses-list');
  const sideBySideContainer = document.getElementById('side-by-side-container');

  const TYPE_DESCRIPTIONS = {
    Clear: 'Direct, unambiguous, and coherent expression of the core message.',
    Minimizing: 'Downplays severity, urgency, or significance as minor or negligible.',
    Informal: 'Casual slang, colloquial phrasing, or informal texting shorthand.',
    Incomplete: 'Fragmented or trailing off, leaving out critical context or details.',
    Conflicting: 'Contains contradictory signals, mixed feelings, or opposing facts.'
  };

  let currentSeed = '';
  let currentVariations = [];

  // Preset buttons
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetText = btn.getAttribute('data-preset');
      if (presetText) {
        seedInput.value = presetText;
        seedInput.focus();
        hideError();
      }
    });
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    seedInput.value = '';
    seedInput.focus();
    hideError();
    resultsSection.classList.add('hidden');
    prismEvalSection.classList.add('hidden');
    prismEvolveSection.classList.add('hidden');
    currentVariations = [];
    currentSeed = '';
  });

  // Generate Baseline Variations
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputVal = seedInput.value.trim();

    if (!inputVal) {
      showError('Please enter a seed input before generating variations.');
      seedInput.focus();
      return;
    }

    hideError();
    setButtonLoading(generateBtn, true);

    try {
      const response = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedInput: inputVal })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      currentSeed = data.seedInput;
      currentVariations = data.variations || [];

      renderResults(data);
      prismEvalSection.classList.add('hidden');
      prismEvolveSection.classList.add('hidden');
    } catch (err) {
      console.error('Generation error:', err);
      showError(err.message || 'An unexpected error occurred while generating variations.');
    } finally {
      setButtonLoading(generateBtn, false);
    }
  });

  // Render variations
  function renderResults(data) {
    displaySeed.textContent = `"${data.seedInput}"`;
    variationsGrid.innerHTML = '';

    currentVariations.forEach((item) => {
      const card = document.createElement('div');
      card.className = `variation-card card-${escapeHtml(item.type)}`;

      const desc = TYPE_DESCRIPTIONS[item.type] || 'Stress-test variation';

      card.innerHTML = `
        <div class="variation-header">
          <div class="variation-badge-group">
            <span class="type-badge badge-${escapeHtml(item.type)}">${escapeHtml(item.type)}</span>
            <span class="type-desc">${escapeHtml(desc)}</span>
          </div>
          <button type="button" class="copy-btn" data-text="${escapeHtml(item.text)}">
            Copy
          </button>
        </div>
        <div class="variation-text">${escapeHtml(item.text)}</div>
      `;

      const copyBtn = card.querySelector('.copy-btn');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.text);
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
        }
      });

      variationsGrid.appendChild(card);
    });

    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Copy all variations
  copyAllBtn.addEventListener('click', async () => {
    if (!currentVariations.length) return;

    const fullText = currentVariations.map(v => `[${v.type}]\n${v.text}\n`).join('\n');
    try {
      await navigator.clipboard.writeText(fullText);
      const originalText = copyAllBtn.textContent;
      copyAllBtn.textContent = '✓ All Copied!';
      setTimeout(() => { copyAllBtn.textContent = originalText; }, 2000);
    } catch (err) {
      console.error('Failed to copy all:', err);
    }
  });

  // PRISM: Run Evaluation
  evaluatePrismBtn.addEventListener('click', async () => {
    if (!currentVariations.length || !currentSeed) {
      showError('Please generate variations first before running PRISM evaluation.');
      return;
    }

    hideError();
    setButtonLoading(evaluatePrismBtn, true);

    try {
      const response = await fetch('/api/prism/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedInput: currentSeed,
          variations: currentVariations
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Evaluation failed with status ${response.status}`);
      }

      renderPrismEvaluation(data.evaluation);
    } catch (err) {
      console.error('PRISM evaluation error:', err);
      showError(err.message || 'Failed to complete PRISM evaluation.');
    } finally {
      setButtonLoading(evaluatePrismBtn, false);
    }
  });

  function renderPrismEvaluation(evalData) {
    evalOverallScore.textContent = evalData.overallScore;
    prismOverallBadge.textContent = `${evalData.overallScore} / 100`;
    evalStatusLabel.textContent = evalData.status;

    // Dimension bars
    const dims = evalData.dimensions || {};
    const semScore = dims.semanticPreservation || 0;
    const distScore = dims.categoryDistinctiveness || 0;
    const stressScore = dims.stressEfficacy || 0;

    dimSemanticBar.style.width = `${semScore}%`;
    dimSemanticVal.textContent = `${semScore}%`;

    dimDistinctBar.style.width = `${distScore}%`;
    dimDistinctVal.textContent = `${distScore}%`;

    dimStressBar.style.width = `${stressScore}%`;
    dimStressVal.textContent = `${stressScore}%`;

    // Category scores
    const catScores = evalData.categoryScores || {};
    categoryScoresContainer.innerHTML = '';

    Object.keys(catScores).forEach(cat => {
      const score = catScores[cat];
      const div = document.createElement('div');
      div.className = 'category-metric-card';
      div.innerHTML = `
        <div class="category-metric-header">
          <span class="type-badge badge-${escapeHtml(cat)}">${escapeHtml(cat)}</span>
          <span class="category-metric-score">${score}/100</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill fill-green" style="width: ${score}%"></div>
        </div>
      `;
      categoryScoresContainer.appendChild(div);
    });

    // Weaknesses
    const weaknesses = evalData.weaknesses || [];
    weaknessCountBadge.textContent = `${weaknesses.length} Diagnosed`;
    weaknessesList.innerHTML = '';

    if (weaknesses.length === 0) {
      weaknessesList.innerHTML = '<p class="metric-desc">No significant failure patterns detected. Generator is highly robust.</p>';
    } else {
      weaknesses.forEach(w => {
        const item = document.createElement('div');
        item.className = 'weakness-card';
        item.innerHTML = `
          <div class="weakness-card-header">
            <span class="severity-badge severity-${escapeHtml(w.severity)}">${escapeHtml(w.severity)} Priority</span>
            <span class="type-badge badge-${escapeHtml(w.category)}">${escapeHtml(w.category)}</span>
          </div>
          <div class="weakness-issue">${escapeHtml(w.issue)}</div>
          <div class="weakness-suggestion"><strong>PRISM Directive:</strong> ${escapeHtml(w.suggestion)}</div>
        `;
        weaknessesList.appendChild(item);
      });
    }

    // Recommendations
    const recs = evalData.recommendedImprovements || [];
    recommendationsList.innerHTML = '';
    recs.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r;
      recommendationsList.appendChild(li);
    });

    prismEvalSection.classList.remove('hidden');
    prismEvalSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // PRISM: Run Evolution (Before vs After)
  evolvePrismBtn.addEventListener('click', async () => {
    const inputVal = currentSeed || seedInput.value.trim();
    if (!inputVal) {
      showError('Please enter a seed input before running PRISM evolution.');
      return;
    }

    hideError();
    setButtonLoading(evolvePrismBtn, true);

    try {
      const response = await fetch('/api/prism/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedInput: inputVal,
          baselineVariations: currentVariations.length ? currentVariations : null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Evolution failed with status ${response.status}`);
      }

      renderPrismEvolution(data.evolution);
    } catch (err) {
      console.error('PRISM evolution error:', err);
      showError(err.message || 'Failed to complete PRISM evolution cycle.');
    } finally {
      setButtonLoading(evolvePrismBtn, false);
    }
  });

  function renderPrismEvolution(evoData) {
    const comp = evoData.comparison || {};
    const delta = comp.scoreDelta >= 0 ? `+${comp.scoreDelta} pts` : `${comp.scoreDelta} pts`;

    evolutionDeltaBadge.textContent = `${delta} Robustness Gain`;
    evolveBeforeScore.textContent = comp.scoreBefore;
    evolveAfterScore.textContent = comp.scoreAfter;
    evolveBeforeStatus.textContent = comp.statusBefore || 'Baseline';
    evolveAfterStatus.textContent = comp.statusAfter || 'Evolved';
    evolveDeltaText.textContent = `${delta} measurable gain`;

    // Resolved Weaknesses
    const resolved = evoData.resolvedWeaknesses || [];
    resolvedWeaknessesList.innerHTML = '';

    if (resolved.length === 0) {
      resolvedWeaknessesList.innerHTML = '<p class="metric-desc">Baseline was already highly robust. Generator refined for higher diversity and nuance.</p>';
    } else {
      resolved.forEach(r => {
        const div = document.createElement('div');
        div.className = 'resolved-item';
        div.innerHTML = `
          <span class="check-icon">✓</span>
          <div>
            <strong>[${escapeHtml(r.category)}] Overcome:</strong> ${escapeHtml(r.issue)}
            <div style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">${escapeHtml(r.resolution)}</div>
          </div>
        `;
        resolvedWeaknessesList.appendChild(div);
      });
    }

    // Side by side variations comparison
    const beforeVars = evoData.before?.variations || [];
    const afterVars = evoData.after?.variations || [];
    sideBySideContainer.innerHTML = '';

    const types = ['Clear', 'Minimizing', 'Informal', 'Incomplete', 'Conflicting'];

    types.forEach(type => {
      const bText = beforeVars.find(v => v.type === type)?.text || 'N/A';
      const aText = afterVars.find(v => v.type === type)?.text || 'N/A';
      const bScore = evoData.before?.evaluation?.categoryScores?.[type] || '--';
      const aScore = evoData.after?.evaluation?.categoryScores?.[type] || '--';

      const card = document.createElement('div');
      card.className = 'comparison-card';
      card.innerHTML = `
        <div class="variation-header">
          <div class="variation-badge-group">
            <span class="type-badge badge-${escapeHtml(type)}">${escapeHtml(type)}</span>
            <span class="type-desc">Score: ${bScore} → <strong style="color:#34d399">${aScore}</strong></span>
          </div>
        </div>
        <div class="comparison-cols">
          <div class="col-panel">
            <span class="col-tag">Baseline (Before)</span>
            <div class="comparison-text">${escapeHtml(bText)}</div>
          </div>
          <div class="col-panel">
            <span class="col-tag tag-evolved">Evolved (After)</span>
            <div class="comparison-text text-evolved">${escapeHtml(aText)}</div>
          </div>
        </div>
      `;
      sideBySideContainer.appendChild(card);
    });

    prismEvolutionSection.classList.remove('hidden');
    prismEvolutionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setButtonLoading(btn, isLoading) {
    if (!btn) return;
    if (isLoading) {
      btn.classList.add('btn-loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    errorBanner.classList.add('hidden');
    errorMessage.textContent = '';
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
