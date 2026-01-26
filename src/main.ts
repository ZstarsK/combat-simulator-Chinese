import 'src/shared/constants';
import { MICSR } from './shared/micsr';
import { SimClasses } from 'src/shared/simulator/sim';
import type { SimGame } from 'src/shared/simulator/sim-game';
import { Global as SharedGlobal } from 'src/shared/global';
import { Global } from './app/global';
import { Simulation } from './app/simulation';
import { UserInterface } from './app/user-interface/user-interface';
import { GamemodeConverter } from './shared/converter/gamemode';
import { EquipmentController } from './app/user-interface/pages/_parts/equipment/equipment-controller';
import { DialogController } from './app/user-interface/_parts/dialog/dialog-controller';
import { Lookup } from './shared/utils/lookup';
import { Bugs } from './app/user-interface/bugs/bugs';
import { SettingsController, Settings } from './app/settings-controller';
import { clone, cloneDeep } from 'lodash-es';
import { SaveSlot } from './app/utils/save-slot';
import type { Switch } from './app/user-interface/_parts/switch/switch';

interface GameVersion {
    major: number;
    minor: number;
    patch: number;
}

export abstract class Main {
    private static loading = false;
    private static versionKey = 'MICSR-gameVersion';
    private static gameVersion: GameVersion = { major: 1, minor: 3, patch: 1 };
    private static registeredNamespaces: string[] = [];

    public static init(context: Modding.ModContext) {
        SharedGlobal.setClient(Global);
        Global.context = context;

        try {
            this.setWindowObject();
        } catch {}

        Global.context.api({
            isLoaded: Global.isLoaded,
            import: (settings: Settings) => SettingsController.import(settings),
            export: () => SettingsController.export(),
            registerNamespace: (namespace: string) => {
                if (namespace && typeof namespace === 'string') {
                    this.registeredNamespaces.push(namespace.toLowerCase());
                }
            },
            registeredNamespaces: () => clone(this.registeredNamespaces)
        });

        Global.userInterface = new UserInterface();

        try {
            SaveSlot.init();
        } catch (error) {
            Global.logger.error('初始化 indexeddb 失败', error);
        }

        Global.context
            .patch(CombatSkillProgressTableElement, 'updateLevelCapButtons')
            .replace((original, game: SimGame) => {
                if (!game.isMcsGame) {
                    return original(game);
                }
            });

        Global.context.onInterfaceReady(async () => {
            try {
                for (const template of Global.templates) {
                    await Global.context.loadTemplates(template);
                }

                await this.load();
                Global.loaded(true);
            } catch (error) {
                Global.loaded(false);
                Bugs.report(false, error);
            }
        });

        Global.context.patch(Game, 'registerDataPackage').before(dataPackage => {
            if (dataPackage.namespace.startsWith('melvor') || this.loading) {
                return;
            }

            Global.dataPackages.push(cloneDeep(dataPackage));
        });

        Global.context.patch(Game, 'registerSkill').after((instance, namespace) => {
            if (!namespace.isModded || this.loading) {
                return;
            }

            Global.skills.push({ name: instance._localID, namespace, media: instance._media });
        });
    }

    private static async load() {
        this.loading = true;
        await SimClasses.init();

        let { tryLoad, isWrongVersion } = await this.tryToLoad();

        if (tryLoad) {
            try {
                const duration = await Global.time(async () => {
                    Global.micsr = new MICSR();
                    Global.game = new SimClasses.SimGame();
                    Global.melvor = game;

                    await Global.micsr.fetchData();
                    await Global.micsr.initialize();

                    Global.dataPackages = Global.dataPackages.filter(dataPackage =>
                        this.registeredNamespaces.includes(dataPackage.namespace.toLowerCase())
                    );

                    Global.skills = Global.skills.filter(skill =>
                        this.registeredNamespaces.includes(skill.namespace.name.toLowerCase())
                    );

                    this.setup();

                    Global.simulation = new Simulation();

                    const isRegistered = this.invalidGamemodeCheck();

                    let saveString = Global.melvor.generateSaveString();

                    if (!isRegistered) {
                        const temporary = Global.melvor.currentGamemode;
                        Global.melvor.currentGamemode = Global.melvor.gamemodes.getObjectByID('melvorD:Standard');
                        saveString = Global.melvor.generateSaveString();
                        Global.melvor.currentGamemode = temporary;
                    }

                    const reader = new SaveWriter('Read', 1);
                    const saveVersion = reader.setDataFromSaveString(saveString);

                    Global.game.decode(reader, saveVersion);
                    Global.game.onLoad();
                    Global.game.resetToBlankState();

                    EquipmentController.init();
                    Global.userInterface.init();
                });

                await Global.simulation.init();

                if (isWrongVersion) {
                    Global.logger.log(
                        `v${Global.context.version} 已加载，但由于游戏版本不兼容，模拟结果可能不准确。`
                    );

                    localStorage.setItem(this.versionKey, gameVersion);
                }

                delete Global.dataPackages;
                delete Global.skills;

                Global.logger.log(`Initialised in ${duration} ms [${Global.context.version}]`);
            } catch (error) {
                Global.logger.error(
                    `${Global.context.name} ${Global.context.version} was not loaded due to the following error:\n\n`,
                    error
                );
                Bugs.report(false, error);
            }
        } else {
            Global.logger.warn(
                `由于用户拒绝加载不兼容版本，未加载 v${Global.context.version}。`
            );
        }
    }

    private static tryToLoad() {
        const isWrongVersion = !this.isGameVersionSupported(this.getGameVersion(), this.gameVersion);

        let resolve: (result: { isWrongVersion: boolean; tryLoad: boolean }) => void;
        const wait = new Promise<{ isWrongVersion: boolean; tryLoad: boolean }>(_ => (resolve = _));

        if (isWrongVersion && gameVersion !== localStorage.getItem('MICSR-gameVersion')) {
            const backdrop = createElement('div', { id: 'mcs-dialog-backdrop' });
            const dialog = createElement('mcs-dialog', { id: 'mcs-wrong-version' });

            dialog.innerHTML = `
                <div slot="header">不兼容的游戏版本</div>

                <div slot="content">
                    <div>此版本的战斗模拟器已针对 v${this.gameVersion.major}.${this.gameVersion.minor}.${this.gameVersion.patch} 进行测试，但 Melvor 正在运行 ${gameVersion}。无法保证战斗模拟器能正常工作。</div>
                    <br />
                    <div>您是否仍要尝试加载模拟器？</div>
                </div>

                <div slot="footer">
                    <button id="mcs-wrong-version-cancel" class="mcs-button-secondary">取消</button>
                    <button id="mcs-wrong-version-load" class="mcs-button">尝试加载</button>
                </div>
            `;

            const load = dialog.querySelector<HTMLButtonElement>('#mcs-wrong-version-load');
            const cancel = dialog.querySelector<HTMLButtonElement>('#mcs-wrong-version-cancel');

            cancel.onclick = () => {
                DialogController.close();
                dialog.remove();
                backdrop.remove();
                resolve({ isWrongVersion, tryLoad: false });
            };

            load.onclick = () => {
                DialogController.close();
                dialog.remove();
                backdrop.remove();
                resolve({ isWrongVersion, tryLoad: true });
            };

            document.body.appendChild(backdrop);
            document.body.appendChild(dialog);

            DialogController.open(dialog, undefined, false);
        } else {
            resolve({ isWrongVersion, tryLoad: true });
        }

        return wait;
    }

    private static getGameVersion() {
        const version = gameVersion
            .replace('v', '')
            .split('.')
            .map(version => parseInt(version, 10));

        return {
            major: version[0] ?? 0,
            minor: version[1] ?? 0,
            patch: version[2] ?? 0
        };
    }

    private static isGameVersionSupported(current: GameVersion, supported: GameVersion) {
        if (current.major > supported.major) {
            return false;
        }

        if (current.minor > supported.minor) {
            return false;
        }

        if (current.patch > supported.patch) {
            return false;
        }

        return true;
    }

    private static invalidGamemodeCheck() {
        const gamemodeRegistered =
            Global.game.gamemodes.find(gamemode => gamemode.id === Global.melvor.currentGamemode.id) !== undefined;

        const ignore = localStorage.getItem('mcs-ignore-gamemode-warning') === 'true';

        if (!gamemodeRegistered && !ignore) {
            const backdrop = createElement('div', { id: 'mcs-dialog-backdrop' });
            const dialog = createElement('mcs-dialog', { id: 'mcs-invalid-gamemode' });

            dialog.innerHTML = `
                <div slot="header">[战斗模拟器] 游戏模式未注册</div>

                <div slot="content">
                    <div>您的游戏模式 '${Global.melvor.currentGamemode.name}' 尚未在战斗模拟器中注册。</div>
                    <br />
                    <div>请联系 '${Global.melvor.currentGamemode.name}' 的作者，要求他们在战斗模拟器中注册其模组。您的游戏模式将在战斗模拟器中默认为标准模式。</div>
                    <mcs-switch
                        id="mcs-invalid-gamemode-ignore"
                        style="margin-top: 20px; display: block;"
                        data-mcsOnText="是"
                        data-mcsOffText="否"
                        data-mcsName="忽略未来的无效游戏模式警告">
                    </mcs-switch>
                </div>

                <div slot="footer">
                    <button id="mcs-no-gamemode-ok" class="mcs-button">确定</button>
                </div>
            `;

            const ok = dialog.querySelector<HTMLButtonElement>('#mcs-no-gamemode-ok');
            const ignore = dialog.querySelector<Switch>('#mcs-invalid-gamemode-ignore');

            ok.onclick = () => {
                DialogController.close();
                dialog.remove();
                backdrop.remove();
            };

            ignore._on(isChecked => {
                localStorage.setItem('mcs-ignore-gamemode-warning', isChecked ? 'true' : 'false');
            });

            document.body.appendChild(backdrop);
            document.body.appendChild(dialog);

            DialogController.open(dialog, undefined, false);
        }

        return gamemodeRegistered;
    }

    private static setup() {
        Global.micsr.setup({
            dataPackage: Global.dataPackages,
            skills: Global.skills,
            namespaces: Array.from(Global.melvor.registeredNamespaces.registeredNamespaces.values()).filter(
                namespace => namespace.isModded
            ),
            gamemodes: Global.melvor.gamemodes.allObjects.map(gamemode => GamemodeConverter.get(gamemode)),
            currentGamemodeId: Global.melvor.currentGamemode.id
        });

        const monsterIds: string[] = [];

        for (const area of Lookup.combatAreas.combatAreas) {
            for (const monster of area.monsters) {
                monsterIds.push(monster.id);
            }
        }

        monsterIds.push(Global.stores.game.state.bardId);

        for (const area of Lookup.combatAreas.slayer) {
            for (const monster of area.monsters) {
                monsterIds.push(monster.id);
            }
        }

        const dungeonIds = Lookup.combatAreas.dungeons.map(dungeon => dungeon.id);
        const strongholdIds = Lookup.combatAreas.strongholds.map(stronghold => stronghold.id);
        const depthIds = Lookup.combatAreas.depths.map(depth => depth.id);
        const taskIds = Lookup.tasks.allObjects.map(task => task.id);

        Global.stores.game.set({ monsterIds, dungeonIds, strongholdIds, depthIds, taskIds });
    }

    private static setWindowObject() {
        self.mcs.modifierDiff = () => {
            const mcs = this.diff(Global.game.modifiers.entriesByID, Global.melvor.modifiers.entriesByID);
            const melvor = this.diff(Global.melvor.modifiers.entriesByID, Global.game.modifiers.entriesByID);

            return { mcs, melvor };
        };
    }

    private static diff(compare: Map<string, ModifierTableEntry[]>, to: Map<string, ModifierTableEntry[]>) {
        const lookup: any = {
            no: [],
            yes: [],
            diff: [],
            diffLookup: []
        };

        for (const [key, entry] of Array.from(compare.entries())) {
            if (!to.has(key)) {
                lookup.no.push(key);
                continue;
            }

            const toEntry = to.get(key);

            if (toEntry.length !== entry.length) {
                lookup.diff.push(key);
                lookup.diffLookup.push({ id: key, compare: compare.get(key), to: to.get(key) });
                continue;
            }

            lookup.yes.push(key);
        }

        return lookup;
    }
}
