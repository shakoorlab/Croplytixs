import PropTypes from 'prop-types';
import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import Alert from '@mui/material/Alert';

// project imports
import PageHeader from 'components/PageHeader';
import NewTrainingRunDialog from './NewTrainingRunDialog';
import { useLabelPool } from 'api/models';

// assets
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';

const IMPORTS = [
  { key: 'label-studio', label: 'Label Studio JSON', hint: 'brush RLE export — the format the pilot labels are in' },
  { key: 'coco', label: 'COCO segmentation', hint: 'polygons; rasterised to the clip grid on import' },
  { key: 'png', label: 'PNG masks + clips', hint: 'one binary mask per plot image, paired by stem' }
];

// ==============================|| MODELS - PAGE HEADER ||============================== //

/**
 * Header shared by the four Models tabs: the crumb trail, the label import
 * menu and the "new training run" entry point. Import and start both end in
 * an in-page notice for now; each maps to one endpoint on the models API.
 */
export default function ModelsHeader({ title = 'Models', subtitle, crumbs = [], actions }) {
  const { data: pool } = useLabelPool();
  const [anchor, setAnchor] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  return (
    <Stack sx={{ gap: 2 }}>
      <PageHeader
        crumbs={[{ label: 'Croplytix', to: '/' }, { label: 'Models', to: '/models' }, ...crumbs]}
        title={title}
        subtitle={subtitle}
        actions={
          <Stack direction="row" sx={{ gap: 1 }}>
            {actions}
            <Button
              variant="outlined"
              color="secondary"
              endIcon={<DownOutlined style={{ fontSize: '0.7rem' }} />}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              Import labels
            </Button>
            <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
              {IMPORTS.map((option) => (
                <MenuItem
                  key={option.key}
                  onClick={() => {
                    setAnchor(null);
                    setNotice(
                      `${option.label} import will call POST /api/labels/import — existing labels seed the pool; nothing is re-annotated.`
                    );
                  }}
                >
                  <ListItemText primary={option.label} secondary={option.hint} />
                </MenuItem>
              ))}
            </Menu>
            <Button variant="contained" startIcon={<PlusOutlined />} onClick={() => setDialogOpen(true)}>
              New training run
            </Button>
          </Stack>
        }
      />
      {notice && (
        <Alert severity="info" variant="outlined" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <NewTrainingRunDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        pool={pool}
        onQueued={(run) =>
          setNotice(
            `Run #15 recorded — ${run.mode} from ${run.base}, seed ${run.seed}, ${run.training.toLocaleString('en-US')} labels. It will start when the training job runner exists.`
          )
        }
      />
    </Stack>
  );
}

ModelsHeader.propTypes = {
  title: PropTypes.node,
  subtitle: PropTypes.node,
  crumbs: PropTypes.array,
  actions: PropTypes.node
};
