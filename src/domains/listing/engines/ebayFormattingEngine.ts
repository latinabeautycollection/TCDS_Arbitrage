import { sanitizeEbayHtml } from '../utils/htmlSanitizer';
import { fitEbayTitle } from '../utils/titleLength';
export class EbayFormattingEngine { format<T extends {title:string; descriptionHtml:string}>(draft:T): T { return {...draft, title: fitEbayTitle(draft.title), descriptionHtml: sanitizeEbayHtml(draft.descriptionHtml)}; } }
