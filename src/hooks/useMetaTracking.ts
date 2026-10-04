/**
 * React binding for the Meta Pixel.
 *
 * Mounted ONCE at the app root. It:
 *   * initialises the Pixel only on customer-facing routes,
 *   * fires `PageView` on every customer-facing navigation,
 *   * fires `ViewContent` when the visitor enters the chat experience.
 *
 * Everything else (StartChat, Contact, Lead) is fired by the specific screens at
 * the moment the conversion actually happens, using `trackMetaEvent` directly.
 *
 * StrictMode note: the effect below is intentionally written so a double-mount
 * cannot double-fire. `PageView` is additionally deduplicated by a path-scoped
 * key inside `trackMetaEvent`, so even two identical SPA navigations to the same
 * URL in one session collapse into one event per session.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initMetaPixel, isCustomerFacingPath, trackMetaEvent } from '../lib/metaPixel';

const CUSTOMER_ROOTS = ['/chat', '/welcome'];

function isChatExperience(pathname: string): boolean {
  return CUSTOMER_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function useMetaTracking(): void {
  const location = useLocation();

  // Initialise once. The service is idempotent, so this is safe under StrictMode.
  useEffect(() => {
    if (!isCustomerFacingPath(location.pathname)) return;
    void initMetaPixel();
  }, []);

  // PageView per customer-facing navigation. The dedupe key includes the path so
  // navigating between /chat and /welcome each record a view, while a rerender or
  // a StrictMode double-effect on the same path does not.
  useEffect(() => {
    if (!isCustomerFacingPath(location.pathname)) return;
    void trackMetaEvent('PageView', {}, `pageview:${location.pathname}`);
  }, [location.pathname]);

  // ViewContent when the visitor actually enters the chat experience.
  useEffect(() => {
    if (!isCustomerFacingPath(location.pathname)) return;
    if (!isChatExperience(location.pathname)) return;
    void trackMetaEvent(
      'ViewContent',
      { content_name: 'Support chat', content_category: 'chat' },
      'viewcontent:chat',
    );
  }, [location.pathname]);
}
