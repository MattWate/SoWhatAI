const SCAN_ENGINE_NAME = 'LumenScan';

const LUMEN_RULES = Object.freeze([
  {
    id: 'html-lang-missing',
    impact: 'serious',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag311'],
    category: 'core',
    summary: 'Root html element is missing a lang attribute.'
  },
  {
    id: 'document-title-missing',
    impact: 'serious',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag242'],
    category: 'core',
    summary: 'Document title is missing or empty.'
  },
  {
    id: 'image-alt-missing',
    impact: 'serious',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag111'],
    category: 'core',
    summary: 'Image element is missing an alt attribute.'
  },
  {
    id: 'form-control-label-missing',
    impact: 'serious',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag131', 'wcag412'],
    category: 'core',
    summary: 'Form control does not have an associated programmatic label.'
  },
  {
    id: 'button-name-missing',
    impact: 'serious',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag412'],
    category: 'core',
    summary: 'Interactive button control is missing an accessible name.'
  },
  {
    id: 'link-name-missing',
    impact: 'serious',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag244', 'wcag412'],
    category: 'core',
    summary: 'Link is missing discernible text or an accessible name.'
  },
  {
    id: 'iframe-title-missing',
    impact: 'moderate',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag241', 'wcag412'],
    category: 'core',
    summary: 'IFrame element is missing a title or accessible name.'
  },
  {
    id: 'duplicate-id',
    impact: 'minor',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag411'],
    category: 'core',
    summary: 'Duplicate id values were detected on the page.'
  },
  {
    id: 'heading-order-skipped',
    impact: 'minor',
    profileTags: ['wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag131', 'wcag246'],
    category: 'core',
    summary: 'Heading levels should not skip intermediate levels.'
  },
  {
    id: 'positive-tabindex',
    impact: 'minor',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508'],
    wcagRefs: ['wcag243'],
    category: 'best-practice',
    summary: 'Avoid positive tabindex values to preserve logical keyboard order.'
  },
  {
    id: 'video-caption-track-missing',
    impact: 'moderate',
    profileTags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
    wcagRefs: ['wcag122'],
    category: 'experimental',
    summary: 'Video element appears to be missing captions/subtitles tracks.'
  }
]);

function selectEngineRules(profileTags) {
  const tagSet = new Set(Array.isArray(profileTags) ? profileTags : []);
  const includeBestPractices = tagSet.has('best-practice');
  const includeExperimental = tagSet.has('experimental');
  return LUMEN_RULES.filter((rule) => {
    if (!rule.profileTags.some((tag) => tagSet.has(tag))) return false;
    if (rule.category === 'best-practice' && !includeBestPractices) return false;
    if (rule.category === 'experimental' && !includeExperimental) return false;
    return true;
  });
}

async function collectEngineViolations(
  page,
  {
    engineRules,
    includeSelectors,
    excludeSelectors,
    maxNodeSamples,
    maxHtmlSnippetLength,
    maxFailureSummaryLength
  }
) {
  return page.evaluate(
    ({
      rules,
      includeSelectors,
      excludeSelectors,
      maxNodeSamples,
      maxHtmlSnippetLength,
      maxFailureSummaryLength
    }) => {
      const trim = (value, maxLength) => {
        const text = String(value || '');
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
      };

      const safeQueryAll = (root, selector) => {
        try {
          return Array.from(root.querySelectorAll(selector));
        } catch {
          return [];
        }
      };

      const ruleById = new Map((Array.isArray(rules) ? rules : []).map((rule) => [rule.id, rule]));
      const violations = [];

      const escapeCss = (value) => {
        const input = String(value || '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(input);
        return input.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/\\@])/g, '\\$1');
      };

      const roots = (() => {
        if (!Array.isArray(includeSelectors) || includeSelectors.length === 0) {
          return [document.documentElement];
        }
        const output = [];
        for (const selector of includeSelectors) {
          if (!selector) continue;
          output.push(...safeQueryAll(document, selector));
        }
        return output.length > 0 ? Array.from(new Set(output)) : [document.documentElement];
      })();

      const matchesSelector = (element, selector) => {
        if (!(element instanceof Element)) return false;
        try {
          return element.matches(selector) || Boolean(element.closest(selector));
        } catch {
          return false;
        }
      };

      const isExcluded = (element) =>
        Array.isArray(excludeSelectors) &&
        excludeSelectors.some((selector) => selector && matchesSelector(element, selector));

      const isInScope = (element) =>
        element instanceof Element &&
        !isExcluded(element) &&
        roots.some((root) => root === element || root.contains(element));

      const queryScoped = (selector) => {
        const output = new Set();
        for (const root of roots) {
          for (const element of safeQueryAll(root, selector)) {
            if (isInScope(element)) output.add(element);
          }
        }
        return Array.from(output);
      };

      const buildSelector = (element) => {
        if (!(element instanceof Element)) return '';
        if (element.id) return `#${escapeCss(element.id)}`;
        const parts = [];
        let current = element;
        let depth = 0;
        while (current && current instanceof Element && depth < 4) {
          const tag = current.tagName.toLowerCase();
          const classNames = String(current.className || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((name) => escapeCss(name));
          const classPart = classNames.length ? `.${classNames.join('.')}` : '';
          let nthPart = '';
          if (current.parentElement) {
            const sameTag = Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === current.tagName
            );
            if (sameTag.length > 1) nthPart = `:nth-of-type(${sameTag.indexOf(current) + 1})`;
          }
          parts.unshift(`${tag}${classPart}${nthPart}`);
          if (current.parentElement && current.parentElement.id) {
            parts.unshift(`#${escapeCss(current.parentElement.id)}`);
            break;
          }
          current = current.parentElement;
          depth += 1;
        }
        return parts.join(' > ');
      };

      const labelledByText = (element) => {
        const ids = String(element.getAttribute('aria-labelledby') || '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        return ids
          .map((id) => {
            const node = document.getElementById(id);
            return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
          })
          .filter(Boolean)
          .join(' ')
          .trim();
      };

      const getAccessibleName = (element) => {
        if (!(element instanceof Element)) return '';
        const ariaLabel = String(element.getAttribute('aria-label') || '').trim();
        if (ariaLabel) return ariaLabel;
        const fromLabelledBy = labelledByText(element);
        if (fromLabelledBy) return fromLabelledBy;
        if (element instanceof HTMLInputElement) {
          const inputType = String(element.type || '').toLowerCase();
          if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') {
            const value = String(element.value || '').trim();
            if (value) return value;
          }
        }
        const alt = String(element.getAttribute('alt') || '').trim();
        if (alt) return alt;
        const title = String(element.getAttribute('title') || '').trim();
        if (title) return title;
        return String(element.textContent || '').replace(/\s+/g, ' ').trim();
      };

      const hasProgrammaticLabel = (element) => {
        if (!(element instanceof Element)) return true;
        if (String(element.getAttribute('aria-label') || '').trim()) return true;
        if (labelledByText(element)) return true;
        if (String(element.getAttribute('title') || '').trim()) return true;
        if (element.id) {
          try {
            const label = document.querySelector(`label[for="${escapeCss(element.id)}"]`);
            if (label && String(label.textContent || '').trim()) return true;
          } catch {}
        }
        const wrappingLabel = element.closest('label');
        return Boolean(wrappingLabel && String(wrappingLabel.textContent || '').trim());
      };

      const addViolation = (ruleId, findings, fallbackSummary) => {
        const rule = ruleById.get(ruleId);
        if (!rule || !Array.isArray(findings) || findings.length === 0) return;
        const nodes = [];
        for (const item of findings.slice(0, maxNodeSamples)) {
          let element = null;
          let summary = fallbackSummary || rule.summary;
          if (item instanceof Element) {
            element = item;
          } else if (item && item.element instanceof Element) {
            element = item.element;
            if (item.summary) summary = String(item.summary);
          }
          if (!element) continue;
          nodes.push({
            target: [buildSelector(element)].filter(Boolean),
            html: trim(String(element.outerHTML || '').replace(/\s+/g, ' '), maxHtmlSnippetLength),
            failureSummary: trim(summary, maxFailureSummaryLength),
            impact: rule.impact
          });
        }
        if (nodes.length === 0) return;
        violations.push({
          id: rule.id,
          impact: rule.impact,
          tags: [...new Set([...(rule.profileTags || []), ...(rule.wcagRefs || [])])],
          nodes
        });
      };

      if (ruleById.has('html-lang-missing')) {
        const lang = String(document.documentElement.getAttribute('lang') || '').trim();
        if (!lang) addViolation('html-lang-missing', [document.documentElement]);
      }

      if (ruleById.has('document-title-missing')) {
        const title = String(document.title || '').trim();
        if (!title) addViolation('document-title-missing', [document.documentElement]);
      }

      if (ruleById.has('image-alt-missing')) {
        const images = queryScoped('img').filter((img) => {
          const role = String(img.getAttribute('role') || '').toLowerCase();
          const hidden = String(img.getAttribute('aria-hidden') || '').toLowerCase() === 'true';
          if (hidden || role === 'presentation' || role === 'none') return false;
          return !img.hasAttribute('alt');
        });
        addViolation('image-alt-missing', images);
      }

      if (ruleById.has('form-control-label-missing')) {
        const controls = queryScoped(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ).filter((element) => !hasProgrammaticLabel(element));
        addViolation('form-control-label-missing', controls);
      }

      if (ruleById.has('button-name-missing')) {
        const buttons = queryScoped(
          'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
        ).filter((element) => getAccessibleName(element) === '');
        addViolation('button-name-missing', buttons);
      }

      if (ruleById.has('link-name-missing')) {
        const links = queryScoped('a[href], [role="link"]').filter((element) => getAccessibleName(element) === '');
        addViolation('link-name-missing', links);
      }

      if (ruleById.has('iframe-title-missing')) {
        const frames = queryScoped('iframe').filter((element) => getAccessibleName(element) === '');
        addViolation('iframe-title-missing', frames);
      }

      if (ruleById.has('duplicate-id')) {
        const idBuckets = new Map();
        for (const element of queryScoped('[id]')) {
          const id = String(element.getAttribute('id') || '').trim();
          if (!id) continue;
          const bucket = idBuckets.get(id) || [];
          bucket.push(element);
          idBuckets.set(id, bucket);
        }
        const duplicates = [];
        for (const [id, elements] of idBuckets.entries()) {
          if (elements.length < 2) continue;
          for (const element of elements) {
            duplicates.push({ element, summary: `Duplicate id "${id}" appears ${elements.length} times on this page.` });
            if (duplicates.length >= maxNodeSamples) break;
          }
          if (duplicates.length >= maxNodeSamples) break;
        }
        addViolation('duplicate-id', duplicates);
      }

      if (ruleById.has('heading-order-skipped')) {
        const headingIssues = [];
        let previousLevel = 0;
        for (const heading of queryScoped('h1, h2, h3, h4, h5, h6')) {
          const level = Number.parseInt(String(heading.tagName || '').slice(1), 10);
          if (!Number.isFinite(level)) continue;
          if (previousLevel > 0 && level > previousLevel + 1) {
            headingIssues.push({
              element: heading,
              summary: `Heading level jumped from h${previousLevel} to h${level}.`
            });
            if (headingIssues.length >= maxNodeSamples) break;
          }
          previousLevel = level;
        }
        addViolation('heading-order-skipped', headingIssues);
      }

      if (ruleById.has('positive-tabindex')) {
        const tabindexNodes = queryScoped('[tabindex]').filter((element) => {
          const tabindex = Number.parseInt(String(element.getAttribute('tabindex') || ''), 10);
          return Number.isFinite(tabindex) && tabindex > 0;
        });
        addViolation('positive-tabindex', tabindexNodes);
      }

      if (ruleById.has('video-caption-track-missing')) {
        const videos = queryScoped('video').filter(
          (element) => !element.querySelector('track[kind="captions"], track[kind="subtitles"]')
        );
        addViolation('video-caption-track-missing', videos);
      }

      return { violations };
    },
    {
      rules: Array.isArray(engineRules)
        ? engineRules.map((rule) => ({
            id: rule.id,
            impact: rule.impact,
            profileTags: rule.profileTags,
            wcagRefs: rule.wcagRefs,
            summary: rule.summary
          }))
        : [],
      includeSelectors: Array.isArray(includeSelectors) ? includeSelectors : [],
      excludeSelectors: Array.isArray(excludeSelectors) ? excludeSelectors : [],
      maxNodeSamples,
      maxHtmlSnippetLength,
      maxFailureSummaryLength
    }
  );
}

export { SCAN_ENGINE_NAME, selectEngineRules, collectEngineViolations };
