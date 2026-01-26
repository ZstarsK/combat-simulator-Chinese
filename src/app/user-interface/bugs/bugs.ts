import './bugs.scss';
import { Global } from 'src/app/global';
import { SettingsController } from 'src/app/settings-controller';
import { DialogController } from 'src/app/user-interface/_parts/dialog/dialog-controller';
import { Util } from 'src/shared/util';

export abstract class Bugs {
    public static report(isLoaded: boolean, error?: Error) {
        let isWillIDie = false;

        try {
            isWillIDie = error && !isLoaded && mod.manager.getLoadedModList().includes('Will I Die?');
        } catch {}

        if (error) {
            Global.logger.error(error);
        }

        const backdrop = createElement('div', { id: 'mcs-dialog-backdrop' });
        const dialog = createElement('mcs-dialog', { id: 'mcs-bugs' });

        if (isWillIDie) {
            dialog.innerHTML += `<div slot="header">移除 Will I Die</div>
                <div slot="content" class="mcs-with-textarea">
                    <div>您已安装 Will I Die！</div>
                    <br />
                    <div>此模组尚未针对当前游戏版本进行更新，应禁用。此过时版本的 Will I Die 会导致战斗模拟器无法运行。</div>
                    <br />
                    <div>请检查您的所有模组！</div>
                    <textarea readonly="readonly" class="mcs-bugs-content form-control mcs-code" rows="4"></textarea>
                </div>

                <div slot="footer">
                    <button id="mcs-bugs-done" class="mcs-button">完成</button>
                </div>
                `;
        } else {
            if (error) {
                dialog.innerHTML += `<div slot="header">战斗模拟器错误</div>`;
            } else {
                dialog.innerHTML += `<div slot="header">发现错误？</div>`;
            }

            dialog.innerHTML += `
                    <div slot="content" class="mcs-with-textarea">
                        <div>请在 Melvor Discord 模组错误报告频道寻求帮助。</div>
                        <br />
                        <div>以下信息包含您的存档文件和战斗模拟器配置的副本（如果可能）。</div>
                        <br />
                        <textarea readonly="readonly" class="mcs-bugs-content form-control mcs-code" rows="4"></textarea>
                    </div>

                    <div slot="footer">
                        <button id="mcs-bugs-done" class="mcs-button">完成</button>
                    </div>
                `;
        }

        const textarea = dialog.querySelector<HTMLTextAreaElement>('.mcs-bugs-content');
        const done = dialog.querySelector<HTMLButtonElement>('#mcs-bugs-done');

        if (isWillIDie) {
            textarea.style.display = 'none';
        }

        done.onclick = () => {
            DialogController.close();
            dialog.remove();
            backdrop.remove();
        };

        textarea.onclick = () => textarea.setSelectionRange(0, textarea.value.length);

        if (error) {
            textarea.value += `消息：${error.message}\n\n---\n\n${error.stack}\n\n`;
        }

        let expansionsOwned = [];

        if (
            !cloudManager.hasTotHEntitlementAndIsEnabled &&
            !cloudManager.hasAoDEntitlementAndIsEnabled &&
            !cloudManager.hasItAEntitlementAndIsEnabled
        ) {
            expansionsOwned.push('None');
        } else {
            if (cloudManager.hasTotHEntitlementAndIsEnabled) {
                expansionsOwned.push(`TotH`);
            }

            if (cloudManager.hasAoDEntitlementAndIsEnabled) {
                expansionsOwned.push(`AoD`);
            }

            if (cloudManager.hasItAEntitlementAndIsEnabled) {
                expansionsOwned.push(`ItA`);
            }
        }

        let version = Util.fileVersion();

        if (!version.startsWith('?')) {
            version = `?${version}`;
        }

        textarea.value += `Melvor 版本：${gameVersion}${version}
模拟器版本：${Global.context.version}

已启用扩展：${expansionsOwned.join(', ')}

模组列表：
`;
        for (const modName of mod.manager.getLoadedModList()) {
            textarea.value += ` - ${modName}\n`;
        }

        textarea.value += `
存档字符串：
        `;

        textarea.value += game.generateSaveString();
        textarea.value += `

模拟器字符串：

`;
        try {
            textarea.value += SettingsController.exportAsString();
        } catch (error) {
            textarea.value += error.stack;
        }

        if (!isLoaded) {
            document.body.appendChild(backdrop);
        }

        document.body.appendChild(dialog);

        DialogController.open(dialog, undefined, false);
    }
}
