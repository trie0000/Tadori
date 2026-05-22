declare const __TADORI_BUILD_ID__: string;
declare const __TADORI_VERSION__: string;

interface Window {
  _spPageContextInfo?: { webAbsoluteUrl?: string };
}

declare module '*.css' {
  const content: string;
  export default content;
}
