# SSD2 Dual-Use Role

This Ansible role prepares a **second NVMe SSD** (`ssd2`) for **two purposes**:

1. **Bootable clone of the system root** (first partition)  
   - Provides a quick backup of the system disk.  
   - If the primary SSD fails, you can boot from SSD2.  
   - The clone is updated with `rsync`.  
   - GRUB is installed so the clone is immediately bootable.  

2. **ZFS special vdev for the HDD pool** (second partition)  
   - Stores ZFS metadata and small files for your HDD pool.  
   - Greatly improves performance for random I/O, directory listings, and VM/container images.  
   - Uses the remaining SSD space after the clone partition.  

---

## ⚙️ Variables

Defined in `defaults/main.yml`:

```yaml
# Device for the secondary SSD
ssd2_device: /dev/nvme1n1

# Size of the clone partition (everything after is for ZFS special vdev)
ssd2_clone_size: 100G

# Mount point used temporarily when cloning root
ssd2_clone_mount: /mnt/ssd2clone

# Name of the existing ZFS pool that will receive the special vdev
zfs_pool_name: tank
