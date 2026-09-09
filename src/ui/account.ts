/**
 * Signing in, and registering.
 *
 * One overlay with two faces, because they are the same three fields and a
 * player arriving at it does not yet know which of the two they need. There is
 * no verification mail and no password reset link: this is a game you host for
 * people you know, the email is how they are reached and not a hoop they jump
 * through, and a reset link needs an SMTP server that a self-hoster should not
 * have to stand up to play a siege with their kids.
 *
 * The account is only needed to play TOGETHER. Single-player never asks, which
 * is why this screen is reached from the multiplayer button and not put in
 * front of the title screen.
 */

import {
  login, register, isAuthError, type Account, type AuthError,
} from '../net/session';

const CSS = `
#account {
  position: fixed; inset: 0; z-index: 40; display: flex;
  align-items: center; justify-content: center; padding: 20px;
  background: rgba(9,9,8,.82); backdrop-filter: blur(3px);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
}
#account .card {
  width: 100%; max-width: 380px; padding: 26px 26px 22px;
  background: #17140f; border: 1px solid rgba(196,162,96,.32); border-radius: 7px;
  box-shadow: 0 18px 60px rgba(0,0,0,.6);
}
#account h2 {
  font-size: 19px; letter-spacing: 4px; color: #f0c869; margin: 0 0 3px;
}
#account .sub { font-size: 11px; opacity: .55; line-height: 1.6; margin-bottom: 18px; }
#account label { display: block; font-size: 11px; opacity: .6; margin: 12px 0 4px;
  letter-spacing: 1px; }
#account input {
  width: 100%; box-sizing: border-box; padding: 9px 10px;
  background: #100e0a; color: #ecdfc2; font: inherit; font-size: 13px;
  border: 1px solid #4a4034; border-radius: 3px;
}
#account input:focus { outline: none; border-color: #f0c869; }
#account input.bad { border-color: #d4694a; }
#account .hint { font-size: 10px; opacity: .4; margin-top: 3px; }
#account .msg {
  min-height: 16px; margin-top: 14px; font-size: 11px; color: #e2a05f; line-height: 1.5;
}
#account .go {
  width: 100%; margin-top: 12px; padding: 11px;
  background: #f0c869; color: #241d10; border: 0; border-radius: 4px;
  font: inherit; font-size: 14px; letter-spacing: 3px; font-weight: 700; cursor: pointer;
}
#account .go:disabled { opacity: .45; cursor: default; }
#account .alt {
  margin-top: 15px; font-size: 11px; opacity: .6; text-align: center; line-height: 1.7;
}
#account .alt a { color: #f0c869; cursor: pointer; text-decoration: none; }
#account .alt a:hover { text-decoration: underline; }
#account .back {
  display: block; margin: 14px auto 0; background: transparent; color: #ecdfc2;
  border: 1px solid #4a4034; border-radius: 4px; font: inherit; font-size: 11px;
  padding: 7px 16px; cursor: pointer;
}
`;

/**
 * Show the sign-in screen. Resolves with the account, or null if the player
 * backed out.
 */
export function accountScreen(startOn: 'login' | 'register' = 'login'): Promise<Account | null> {
  return new Promise(resolve => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'account';
    document.body.appendChild(root);

    let mode = startOn;
    let busy = false;

    const close = (result: Account | null) => {
      root.remove(); style.remove(); resolve(result);
    };

    const draw = () => {
      const registering = mode === 'register';
      root.innerHTML = `
        <div class="card">
          <h2>${registering ? 'NEW LORD' : 'SIGN IN'}</h2>
          <div class="sub">${registering
            ? 'An account lets you take a seat in a multiplayer match, and keeps your saved games yours alone.'
            : 'Sign in to play against other lords on this server.'}</div>
          ${registering ? `
            <label for="ac-user">Name</label>
            <input id="ac-user" autocomplete="username" spellcheck="false" maxlength="16">
            <div class="hint">3 to 16 letters, digits, - or _. This is what other players see.</div>
            <label for="ac-email">Email</label>
            <input id="ac-email" type="email" autocomplete="email" spellcheck="false">
            <div class="hint">Used to identify you and nothing else — no mail is sent.</div>
            <label for="ac-pass">Password</label>
            <input id="ac-pass" type="password" autocomplete="new-password">
            <div class="hint">At least 8 characters.</div>
          ` : `
            <label for="ac-user">Name or email</label>
            <input id="ac-user" autocomplete="username" spellcheck="false">
            <label for="ac-pass">Password</label>
            <input id="ac-pass" type="password" autocomplete="current-password">
          `}
          <div class="msg" id="ac-msg"></div>
          <button class="go" id="ac-go">${registering ? 'REGISTER' : 'SIGN IN'}</button>
          <div class="alt">${registering
            ? 'Already have an account? <a id="ac-swap">Sign in</a>'
            : 'New here? <a id="ac-swap">Register</a>'}</div>
          <button class="back" id="ac-back">Back</button>
        </div>`;

      const user = root.querySelector<HTMLInputElement>('#ac-user')!;
      const email = root.querySelector<HTMLInputElement>('#ac-email');
      const pass = root.querySelector<HTMLInputElement>('#ac-pass')!;
      const msg = root.querySelector<HTMLDivElement>('#ac-msg')!;
      const go = root.querySelector<HTMLButtonElement>('#ac-go')!;

      const fail = (e: AuthError) => {
        msg.textContent = e.error;
        // Point at the field the server named, so a rejected form says which
        // line is wrong rather than only that something is.
        const field = e.field === 'email' ? email
          : e.field === 'password' || e.field === 'next' || e.field === 'current' ? pass
          : e.field === 'username' ? user : null;
        if (field) { field.classList.add('bad'); field.focus(); field.select(); }
      };

      const submit = async () => {
        if (busy) return;
        for (const el of [user, email, pass]) el?.classList.remove('bad');
        msg.textContent = '';
        busy = true; go.disabled = true;
        go.textContent = registering ? 'REGISTERING…' : 'SIGNING IN…';
        const out = registering
          ? await register(user.value.trim(), email!.value.trim(), pass.value)
          : await login(user.value.trim(), pass.value);
        busy = false; go.disabled = false;
        go.textContent = registering ? 'REGISTER' : 'SIGN IN';
        if (isAuthError(out)) { fail(out); return; }
        close(out);
      };

      go.onclick = submit;
      // Enter submits from any field: a three-field form where only the last
      // one takes the return key is a small daily annoyance.
      for (const el of [user, email, pass]) {
        el?.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
        });
      }
      root.querySelector<HTMLAnchorElement>('#ac-swap')!.onclick = () => {
        mode = registering ? 'login' : 'register';
        draw();
      };
      root.querySelector<HTMLButtonElement>('#ac-back')!.onclick = () => close(null);
      user.focus();
    };

    draw();
  });
}
