// assets
import { ExperimentOutlined } from '@ant-design/icons';

// icons
const icons = {
  ExperimentOutlined
};

// ==============================|| MENU ITEMS - TRIALS ||============================== //

const trials = {
  id: 'group-trials',
  title: 'Phenotyping',
  type: 'group',
  children: [
    {
      id: 'trials',
      title: 'Field Trials',
      type: 'item',
      url: '/trials',
      icon: icons.ExperimentOutlined,
      breadcrumbs: false
    }
  ]
};

export default trials;
