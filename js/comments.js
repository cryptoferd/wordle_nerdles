import { supabase } from './supabase-client.js';

const DEFAULT_AVATAR = './assets/default-avatar.svg';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function getAvatarUrlMap(comments) {
  const paths = [...new Set((comments || []).map((comment) => comment.avatar_url).filter(Boolean))];
  const map = new Map();

  await Promise.all(paths.map(async (path) => {
    const { data, error } = await supabase.storage
      .from('avatars')
      .createSignedUrl(path, 60 * 60);

    map.set(path, error ? DEFAULT_AVATAR : (data?.signedUrl || DEFAULT_AVATAR));
  }));

  return map;
}

function timeLabel(timestamp) {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

function buildTree(comments) {
  const byId = new Map();
  const roots = [];

  for (const comment of comments) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  for (const comment of byId.values()) {
    if (comment.parent_comment_id && byId.has(comment.parent_comment_id)) {
      byId.get(comment.parent_comment_id).replies.push(comment);
    } else {
      roots.push(comment);
    }
  }

  const sortFn = (a, b) => new Date(a.created_at) - new Date(b.created_at);

  function sortBranch(nodes) {
    nodes.sort(sortFn);
    for (const node of nodes) {
      sortBranch(node.replies);
    }
  }

  sortBranch(roots);
  return roots;
}

function renderCommentNode(comment, avatarMap, sessionUserId) {
  const isOwn = sessionUserId && comment.user_id === sessionUserId;
  const avatarSrc = avatarMap.get(comment.avatar_url) || DEFAULT_AVATAR;
  const catchphrase = comment.catchphrase
    ? `<div class="comment-catchphrase">“${escapeHtml(comment.catchphrase)}”</div>`
    : '';

  return `
    <article class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-main">
        <a class="player-link" href="profile.html?user=${encodeURIComponent(comment.user_id)}">
          <img class="comment-avatar" src="${avatarSrc}" alt="${escapeHtml(comment.display_name || 'Unknown')} profile picture">
        </a>

        <div class="comment-body-wrap">
          <div class="comment-bubble">
            <div class="comment-head">
              <a class="player-link" href="profile.html?user=${encodeURIComponent(comment.user_id)}">
                <strong>${escapeHtml(comment.display_name || 'Unknown')}</strong>
              </a>
              <span class="muted">${timeLabel(comment.created_at)}</span>
            </div>
            ${catchphrase}
            <div class="comment-text">${escapeHtml(comment.body)}</div>
          </div>

          <div class="comment-actions">
            <button type="button" class="comment-action-btn" data-reply-to="${comment.id}">Reply</button>
            ${isOwn ? `<button type="button" class="comment-action-btn danger-link" data-delete-comment="${comment.id}">Delete</button>` : ''}
          </div>

          <div class="reply-form-slot" data-reply-slot="${comment.id}"></div>

          ${comment.replies?.length ? `
            <div class="comment-replies">
              ${comment.replies.map((reply) => renderCommentNode(reply, avatarMap, sessionUserId)).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderComposer(submissionId, replyToId = '') {
  return `
    <form class="comment-form" data-comment-form data-submission-id="${submissionId}" ${replyToId ? `data-parent-comment-id="${replyToId}"` : ''}>
      <textarea
        class="comment-textarea"
        rows="${replyToId ? 2 : 3}"
        maxlength="500"
        placeholder="${replyToId ? 'Write a reply…' : 'Drop a comment…'}"
        required
      ></textarea>
      <div class="comment-form-actions">
        <button type="submit">${replyToId ? 'Reply' : 'Comment'}</button>
        ${replyToId ? `<button type="button" class="ghost-btn cancel-reply-btn" data-cancel-reply="${replyToId}">Cancel</button>` : ''}
      </div>
    </form>
  `;
}

async function fetchCommentsForSubmissionIds(submissionIds) {
  if (!submissionIds.length) return [];

  const { data, error } = await supabase
    .from('comment_feed')
    .select('*')
    .in('submission_id', submissionIds)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function insertComment({ submissionId, parentCommentId, body }) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error('You must be signed in to comment.');

  const { error } = await supabase
    .from('submission_comments')
    .insert({
      submission_id: submissionId,
      parent_comment_id: parentCommentId || null,
      user_id: user.id,
      body: body.trim(),
    });

  if (error) throw error;
}

async function deleteComment(commentId) {
  const { error } = await supabase
    .from('submission_comments')
    .delete()
    .eq('id', commentId);

  if (error) throw error;
}

export async function mountComments({ container, submissions, session, onError, onSuccess }) {
  if (!container) return;

  const submissionIds = submissions.map((row) => row.id).filter(Boolean);
  const comments = await fetchCommentsForSubmissionIds(submissionIds);
  const avatarMap = await getAvatarUrlMap(comments);
  const commentsBySubmission = new Map();

  for (const submissionId of submissionIds) {
    commentsBySubmission.set(submissionId, []);
  }

  for (const comment of comments) {
    if (!commentsBySubmission.has(comment.submission_id)) {
      commentsBySubmission.set(comment.submission_id, []);
    }
    commentsBySubmission.get(comment.submission_id).push(comment);
  }

  container.querySelectorAll('[data-comments-host]').forEach((host) => {
    const submissionId = host.dataset.commentsHost;
    const submissionComments = commentsBySubmission.get(submissionId) || [];
    const tree = buildTree(submissionComments);

    host.innerHTML = `
      <div class="comments-shell">
        <div class="comments-head">
          <strong>Comments</strong>
          <span class="muted">${submissionComments.length} total</span>
        </div>

        ${session?.user
          ? `<div class="comments-composer">${renderComposer(submissionId)}</div>`
          : `<div class="comments-signin-hint muted">Sign in to comment.</div>`}

        <div class="comments-thread">
          ${tree.length
            ? tree.map((comment) => renderCommentNode(comment, avatarMap, session?.user?.id || null)).join('')
            : `<div class="comments-empty muted">No comments yet. Be the first.</div>`}
        </div>
      </div>
    `;
  });

  container.querySelectorAll('[data-comment-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const textarea = form.querySelector('textarea');
      const body = textarea?.value?.trim() || '';
      const submissionId = form.dataset.submissionId;
      const parentCommentId = form.dataset.parentCommentId || '';

      if (!body) return;

      try {
        await insertComment({ submissionId, parentCommentId, body });
        if (typeof onSuccess === 'function') onSuccess(parentCommentId ? 'Reply added.' : 'Comment added.');
        await mountComments({ container, submissions, session, onError, onSuccess });
      } catch (error) {
        console.error(error);
        if (typeof onError === 'function') onError(error);
      }
    });
  });

  container.querySelectorAll('[data-reply-to]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!session?.user) {
        if (typeof onError === 'function') onError(new Error('You must be signed in to reply.'));
        return;
      }

      const commentId = button.dataset.replyTo;
      const slot = container.querySelector(`[data-reply-slot="${commentId}"]`);
      if (!slot) return;

      const submissionCard = button.closest('[data-submission-id]');
      const submissionId = submissionCard?.dataset.submissionId;

      container.querySelectorAll('.reply-form-slot').forEach((node) => {
        if (node !== slot) node.innerHTML = '';
      });

      if (slot.innerHTML.trim()) {
        slot.innerHTML = '';
      } else {
        slot.innerHTML = renderComposer(submissionId, commentId);
        const textarea = slot.querySelector('textarea');
        textarea?.focus();

        const replyForm = slot.querySelector('[data-comment-form]');
        replyForm?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const body = textarea?.value?.trim() || '';
          if (!body) return;

          try {
            await insertComment({ submissionId, parentCommentId: commentId, body });
            if (typeof onSuccess === 'function') onSuccess('Reply added.');
            await mountComments({ container, submissions, session, onError, onSuccess });
          } catch (error) {
            console.error(error);
            if (typeof onError === 'function') onError(error);
          }
        });

        slot.querySelector('[data-cancel-reply]')?.addEventListener('click', () => {
          slot.innerHTML = '';
        });
      }
    });
  });

  container.querySelectorAll('[data-delete-comment]').forEach((button) => {
    button.addEventListener('click', async () => {
      const commentId = button.dataset.deleteComment;
      try {
        await deleteComment(commentId);
        if (typeof onSuccess === 'function') onSuccess('Comment deleted.');
        await mountComments({ container, submissions, session, onError, onSuccess });
      } catch (error) {
        console.error(error);
        if (typeof onError === 'function') onError(error);
      }
    });
  });
}
