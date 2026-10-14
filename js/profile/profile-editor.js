import { profiles } from '../services/index.js';
import { pending, notify } from '../shared/ui.js';

export class InlineEditor {
  constructor() {
    this.card = document.querySelector('.intro-card');
    this.primary = this.card.querySelector('.primary-btn');
    this.secondary = this.card.querySelector('.secondary-btn');
    this.isEditing = false;
    this.saving = false;
    this.elements = [this.card.querySelector('h1'), this.card.querySelector('.job-title'), this.card.querySelector('.desc p')];
    this.secondary.onclick = () => this.isEditing ? this.cancel() : this.startEditing();
    this.primary.onclick = () => this.isEditing ? this.save() : this.onAdd?.();
  }
  startEditing() {
    if (this.isEditing) return;
    this.isEditing = true; this.original = this.elements.map(element => element.textContent);
    this.elements.forEach(element => { element.contentEditable = 'true'; element.style.outline = '1px solid #0073b1'; element.style.borderRadius = '12px'; element.style.padding = '8px'; });
    this.primary.textContent = 'Պահպանել'; this.secondary.textContent = 'Չեղարկել'; this.elements[0].focus();
  }
  async save() {
    if (!this.isEditing || this.saving) return;
    this.saving = true;
    this.secondary.disabled = true;
    const saved = await pending(this.primary, this.card, async () => {
      const parts = this.elements[0].textContent.trim().split(/\s+/);
      const user = await profiles.update({ firstName: parts.shift(), lastName: parts.join(' '), jobTitle: this.elements[1].textContent, description: this.elements[2].textContent });
      this.elements[0].textContent = user.name; this.elements[1].textContent = user.jobTitle; this.elements[2].textContent = user.description;
    });
    this.saving = false; this.secondary.disabled = false;
    if (saved) { this.finish(); notify('Փոփոխությունները պահպանվել են'); }
  }
  cancel() {
    if (!this.isEditing || this.saving) return;
    this.elements.forEach((element, index) => { element.textContent = this.original[index]; });
    this.finish();
  }
  finish() {
    this.elements.forEach(element => { element.contentEditable = 'false'; element.style.outline = ''; element.style.padding = ''; });
    this.isEditing = false; this.primary.textContent = 'Ավելացնել բաժին'; this.secondary.textContent = 'Փոփոխել'; this.secondary.focus();
  }
}
