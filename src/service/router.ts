import { errorHandler } from '@backstage/backend-common';
import express from 'express';
import Router from 'express-promise-router';
import { Logger } from 'winston';
import { Config } from '@backstage/config';

export interface RouterOptions {
  logger: Logger;
  config: Config;
}

const getDashboardModel = async (
  dashboardUID: string,
  host: string,
  token: string | undefined,
) => {
  const response = await fetch(`${host}/api/dashboards/uid/${dashboardUID}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const json = await response.json();
  return json.dashboard;
};

const bufferToBinaryString = (arrayBuffer: ArrayBuffer) =>
  String.fromCharCode(...new Uint8Array(arrayBuffer));

const createImage = async (
  dashboardUID: string,
  panel: number,
  host: string,
  token: string | undefined,
) => {
  const response = await fetch(
    `${host}/render/d-solo/${dashboardUID}/new-dashboard?${[
      'orgId=1',
      `panelId=${panel}`,
    ].join('&')}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const blob = await response.blob();
  return btoa(bufferToBinaryString(await blob.arrayBuffer()));
};

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { config } = options;

  const router = Router();
  router.use(express.json());

  router.get('/snap', async (req, res) => {
    const configuration = req.query.conf as string;
    if (!configuration) {
      res.statusCode = 400;
      res.json({ message: 'No Conf provided' });
      return;
    }

    const grafanas = config.getConfigArray('integrations.znk_grafana');
    if (grafanas) {
      const grafanaTokens: Record<string, string> = {};
      [...grafanas].forEach(grafanasConfig => {
        const hostConfig: string = grafanasConfig.get('host')?.toString() || '';
        const tokenConfig: string =
          grafanasConfig.get('token')?.toString() || '';
        if (hostConfig !== '') grafanaTokens[hostConfig] = tokenConfig;
      });

      const [host, dashboard] = configuration.split('@');

      if (grafanaTokens[host]) {
        const tokenConfig: string = grafanaTokens[host];
        const dashboardObject = await getDashboardModel(
          dashboard,
          host,
          tokenConfig,
        );
        if (dashboardObject) {
          const snapshots: string[] = [];
          await Promise.all(
            [...dashboardObject.panels].map(async panel => {
              snapshots.push(
                await createImage(
                  dashboardObject.uid,
                  panel.id,
                  host,
                  tokenConfig,
                ),
              );
            }),
          );
          res.json({ snapshots });
        } else {
          res.statusCode = 404;
          res.json({ message: 'Dashboard not found' });
        }
      } else {
        res.statusCode = 404;
        res.json({ message: 'Host not found' });
      }
    }
  });

  router.use(errorHandler());
  return router;
}
