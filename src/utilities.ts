import { debug, getInput } from '@actions/core';
import { context } from '@actions/github';
import { Octokit } from '@octokit/rest';
import { parseHTML } from 'linkedom';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm, strikethrough, tables, taskListItems } from 'turndown-plugin-gfm';

import { Err_DontGetTrueRoute } from './toMarkdownConstant';

const Empty_HREF = /^(#|javascript:\s*void\(0\);?\s*)$/;

export const turndownService = new TurndownService({
  hr: '---',
  linkStyle: 'referenced',
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
})
  .use(strikethrough)
  .use(tables)
  .use(taskListItems)
  .use(gfm)
  .addRule('non_url', {
    filter: (node) =>
      ['a', 'area'].includes(node.nodeName.toLowerCase()) &&
      Empty_HREF.test(node.getAttribute('href') || ''),
    replacement: () => ''
  })
  .addRule('img-srcset', {
    filter: ['img'],
    replacement(_, { alt, title, src, srcset }: HTMLImageElement) {
      const [firstSet] = srcset.split(',')[0]?.split(/\s+/) || [];

      const content = [src || firstSet, title && JSON.stringify(title)].filter(
        Boolean
      );
      return `![${alt}](${content.join(' ')})`;
    }
  })
  .addRule('source-srcset', {
    filter: ['picture'],
    replacement(_, node: HTMLPictureElement) {
      const { src, alt, title } = node.querySelector('img') || {};

      const sourceList = Array.from(
        node.querySelectorAll('source'),
        ({ sizes, srcset }) => {
          const size = Math.max(
            ...sizes
              .split(/,|\)/)
              .map((pixel) => parseFloat(pixel.trim()))
              .filter(Boolean)
          );
          const [src] = srcset.split(',')[0]?.split(/\s+/) || [];

          return { size, src };
        }
      );
      const sources = sourceList.sort(({ size: a }, { size: b }) => b - a);

      const content = [
        src || sources[0]?.src,
        title && JSON.stringify(title)
      ].filter(Boolean);

      return `![${alt}](${content.join(' ')})`;
    }
  })
  .remove((node) =>
    node.matches('style, script, aside, form, [class*="ads" i]')
  )
  .keep((node) => node.matches('kbd, iframe, audio, video, source'));

/**
 * add comment to issue
 */
export async function addComment(body: string) {
  const githubToken = getInput('githubToken');

  if (!githubToken) throw new Error('GitHub token was not found');

  const octokit = new Octokit({ auth: githubToken });
  const { issue, repository } = context.payload;

  if (issue && repository)
    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      body,
      issue_number: issue.number
    });

  debug(`issue: ${issue}`);
  debug(`repository: ${repository}`);
  debug(`comment: ${body}`);
}

const IndexHTML = /index\.\w+$/i;
/**
 * Check the input parameters, and get the routing address of the article.
 */
export function getRouteAddr(markdown: string) {
  const { document } = parseHTML(marked(markdown));

  const { href } = document.querySelector('a') || {};

  if (!href) throw new SyntaxError(Err_DontGetTrueRoute);

  const URI = new URL(href);

  URI.pathname = URI.pathname.replace(IndexHTML, '');

  return URI + '';
}

export async function loadPage(path: string) {
  const window = parseHTML(await (await fetch(path)).text());

  Object.defineProperty(window.document, 'baseURI', {
    value: path,
    writable: false
  });
  return window;
}

export const selectorOf = (tag: string) => `${tag}, [class*="${tag}" i]`;

export function HTMLtoMarkdown(document: Document, ignoreSelector = '') {
  const title =
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.trim(),
    time = document.querySelector<HTMLTimeElement>(
      'time, [class*="time" i], [class*="date" i]'
    ),
    author = document.querySelector<HTMLAnchorElement>(
      'a[class*="author" i], [class*="author" i] a'
    );
  const dateTime = new Date(time?.getAttribute('datetime')),
    dateText = new Date(time?.textContent?.trim());

  time?.remove();

  var content = '';

  for (const selector of ['article', 'content', 'main', 'body']) {
    const box = document.querySelector(selectorOf(selector));

    if (box) {
      if (ignoreSelector)
        turndownService.remove((node) => node.matches(ignoreSelector));

      content = turndownService.turndown(box.innerHTML);
      break;
    }
  }

  return {
    meta: {
      title,
      date: new Date(
        +dateTime ? dateTime : +dateText ? dateText : Date.now()
      ).toJSON(),
      author: author?.textContent?.trim(),
      authorURL: author?.href ? new URL(author.href, document.baseURI) + '' : ''
    },
    content
  };
}
